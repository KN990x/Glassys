import { execFile } from "node:child_process";
import { open, lstat, readdir, readFile, realpath } from "node:fs/promises";
import os from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type {
  DirListing,
  FileEntry,
  FileEntryType,
  FilePreview,
  HostCapabilities,
  HostDisk,
  HostOverview,
  LogEntry,
  LogPage,
  LogPriority,
  ServiceScope,
  ServiceStateFilter,
  ServiceUnit,
} from "@glassys/protocol";
import { HttpError } from "./errors.js";
import { defaultDataDir } from "./paths.js";

/*
 * Read-only probes behind the host views. Nothing here changes the machine:
 * every command is a listing (systemctl list-units, journalctl, df) run with
 * execFile — no shell — and a short timeout, the same way host-git.ts reads
 * the branch. Actions in the views are drafted as prompts for the agent.
 */

const execFileAsync = promisify(execFile);
const PROBE_TIMEOUT_MS = 4_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_DIR_ENTRIES = 2_000;
const MAX_PREVIEW_BYTES = 256 * 1024;
const MAX_LOG_LINES = 1_000;

export type Exec = (cmd: string, args: string[]) => Promise<{ stdout: string }>;

const realExec: Exec = async (cmd, args) => {
  const { stdout } = await execFileAsync(cmd, args, {
    timeout: PROBE_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: MAX_OUTPUT_BYTES,
    encoding: "utf8",
  });
  return { stdout: String(stdout) };
};

let exec: Exec = realExec;
let platform: NodeJS.Platform = process.platform;
let caps: Promise<HostCapabilities> | null = null;

/** Tests swap the command runner and the platform; null restores both. */
export function setHostProbeForTests(fn: Exec | null, plat?: NodeJS.Platform): void {
  exec = fn ?? realExec;
  platform = plat ?? process.platform;
  caps = null;
}

async function runs(cmd: string, args: string[]): Promise<boolean> {
  try {
    await exec(cmd, args);
    return true;
  } catch {
    return false;
  }
}

/** Which views this host can fill. Detected once per process. */
export function hostCapabilities(): Promise<HostCapabilities> {
  caps ??= (async () => {
    const systemd = platform === "linux" && (await runs("systemctl", ["--version"]));
    const launchd = platform === "darwin" && (await runs("launchctl", ["version"]));
    const journald = platform === "linux" && (await runs("journalctl", ["--version"]));
    return {
      overview: true,
      services: systemd ? "systemd" : launchd ? "launchd" : null,
      logs: journald ? "journald" : null,
      files: true,
    };
  })();
  return caps;
}

// ---------------------------------------------------------------- overview

/** `df -kP`: POSIX output, 1K blocks, one line per filesystem. */
export function parseDf(stdout: string): HostDisk[] {
  const seen = new Set<string>();
  const disks: HostDisk[] = [];
  for (const line of stdout.split("\n").slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 6) continue;
    const fs = cols[0]!;
    const size = Number(cols[1]) * 1024;
    const used = Number(cols[2]) * 1024;
    const mount = cols.slice(5).join(" ");
    if (!Number.isFinite(size) || size <= 0) continue;
    // Real block devices only: no tmpfs, overlays, snaps or loop mounts, and on
    // macOS only the system and data volumes of the APFS container.
    if (!fs.startsWith("/dev/") || fs.startsWith("/dev/loop")) continue;
    if (mount.startsWith("/snap/") || mount.startsWith("/boot/efi")) continue;
    if (mount.startsWith("/System/Volumes/") && mount !== "/System/Volumes/Data") continue;
    // Xcode mounts one read-only disk image per simulator runtime, and macOS
    // mounts its recovery volume on its own now and then.
    if (mount.startsWith("/Library/Developer/") || mount === "/Volumes/Recovery") continue;
    if (seen.has(fs)) continue;
    seen.add(fs);
    disks.push({ mount, fs, size, used });
  }
  return disks;
}

/** SwapTotal and SwapFree from /proc/meminfo, in bytes. */
export function parseMeminfoSwap(text: string): { total: number; used: number } | undefined {
  const kb = (key: string) => Number(text.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"))?.[1]);
  const total = kb("SwapTotal");
  const free = kb("SwapFree");
  if (!Number.isFinite(total) || !Number.isFinite(free) || total <= 0) return undefined;
  return { total: total * 1024, used: (total - free) * 1024 };
}

/** MemAvailable from /proc/meminfo, in bytes: what the kernel could hand out without swapping. */
export function parseMeminfoAvailable(text: string): number | undefined {
  const kb = Number(text.match(/^MemAvailable:\s+(\d+)/m)?.[1]);
  return Number.isFinite(kb) ? kb * 1024 : undefined;
}

/**
 * Reclaimable memory from `vm_stat`: free, inactive and speculative pages. On
 * macOS os.freemem() counts only free pages, so a Mac with its file cache
 * warm read as 90% used.
 */
export function parseVmStatAvailable(stdout: string): number | undefined {
  const page = Number(stdout.match(/page size of (\d+) bytes/)?.[1]);
  const pages = (label: string) => Number(stdout.match(new RegExp(`^Pages ${label}:\\s+(\\d+)`, "m"))?.[1]);
  const free = pages("free");
  const inactive = pages("inactive");
  const speculative = pages("speculative");
  if (![page, free, inactive].every(Number.isFinite)) return undefined;
  return (free + inactive + (Number.isFinite(speculative) ? speculative : 0)) * page;
}

async function availableMemory(meminfo: string | undefined): Promise<number> {
  if (meminfo) {
    const available = parseMeminfoAvailable(meminfo);
    if (available !== undefined) return available;
  }
  if (platform === "darwin") {
    try {
      const available = parseVmStatAvailable((await exec("vm_stat", [])).stdout);
      if (available !== undefined) return available;
    } catch {
      /* fall back to free pages */
    }
  }
  return os.freemem();
}

export function parseOsRelease(text: string): string | undefined {
  const m = text.match(/^PRETTY_NAME="?([^"\n]+)"?/m);
  return m?.[1];
}

async function osName(): Promise<string> {
  if (platform === "linux") {
    try {
      const pretty = parseOsRelease(await readFile("/etc/os-release", "utf8"));
      if (pretty) return pretty;
    } catch {
      /* fall through to os.type() */
    }
  }
  if (platform === "darwin") {
    try {
      const { stdout } = await exec("sw_vers", ["-productVersion"]);
      return `macOS ${stdout.trim()}`;
    } catch {
      /* fall through */
    }
  }
  return os.type();
}

export async function hostOverview(): Promise<HostOverview> {
  const [name, disks, meminfo] = await Promise.all([
    osName(),
    exec("df", ["-kP"]).then(
      (r) => parseDf(r.stdout),
      () => [] as HostDisk[],
    ),
    platform === "linux" ? readFile("/proc/meminfo", "utf8").catch(() => undefined) : Promise.resolve(undefined),
  ]);
  const swap = meminfo ? parseMeminfoSwap(meminfo) : undefined;
  const total = os.totalmem();
  const available = Math.min(total, await availableMemory(meminfo));
  const load = os.loadavg();
  return {
    hostname: os.hostname(),
    os: name,
    kernel: os.release(),
    arch: os.arch(),
    uptimeSec: Math.floor(os.uptime()),
    load: [load[0] ?? 0, load[1] ?? 0, load[2] ?? 0],
    cpus: os.cpus().length,
    mem: { total, used: Math.max(0, total - available) },
    ...(swap ? { swap } : {}),
    disks,
  };
}

// ---------------------------------------------------------------- services

type SystemctlJsonUnit = { unit?: string; load?: string; active?: string; sub?: string; description?: string };

export function parseSystemctlJson(stdout: string): ServiceUnit[] {
  const rows = JSON.parse(stdout) as SystemctlJsonUnit[];
  return rows
    .filter((r) => typeof r.unit === "string")
    .map((r) => ({
      name: r.unit!,
      description: r.description ?? "",
      load: r.load ?? "",
      active: r.active ?? "",
      sub: r.sub ?? "",
    }));
}

/** `--plain --no-legend`, for systemd older than 246 (no --output=json). */
export function parseSystemctlPlain(stdout: string): ServiceUnit[] {
  const units: ServiceUnit[] = [];
  for (const raw of stdout.split("\n")) {
    const line = raw.replace(/^[●*\s]+/, "").trimEnd();
    if (!line) continue;
    const m = line.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/);
    if (!m) continue;
    units.push({ name: m[1]!, load: m[2]!, active: m[3]!, sub: m[4]!, description: m[5] ?? "" });
  }
  return units;
}

/** `launchctl list`: PID, last exit status and label, tab-separated. */
export function parseLaunchctl(stdout: string): ServiceUnit[] {
  const units: ServiceUnit[] = [];
  for (const line of stdout.split("\n").slice(1)) {
    const [pid, status, label] = line.split("\t");
    if (!label) continue;
    const running = pid !== undefined && pid !== "-";
    // A negative status is the signal launchd stopped the job with — an idle
    // agent it reaped on demand, not a failure. Only a positive exit code is.
    const code = Number(status);
    const failed = !running && Number.isFinite(code) && code > 0;
    units.push({
      name: label.trim(),
      description: "",
      load: "loaded",
      active: running ? "active" : failed ? "failed" : "inactive",
      sub: running ? "running" : failed ? `exit ${status}` : "dead",
    });
  }
  return units;
}

function filterState(units: ServiceUnit[], state: ServiceStateFilter): ServiceUnit[] {
  if (state === "failed") return units.filter((u) => u.active === "failed");
  if (state === "active") return units.filter((u) => u.active === "active");
  return units;
}

export async function listServices(scope: ServiceScope, state: ServiceStateFilter): Promise<ServiceUnit[]> {
  const cap = await hostCapabilities();
  if (cap.services === "launchd") {
    const { stdout } = await exec("launchctl", ["list"]);
    return filterState(parseLaunchctl(stdout), state);
  }
  if (cap.services !== "systemd") throw new HttpError(404, "service manager not available on this host");
  const base = [...(scope === "user" ? ["--user"] : []), "list-units", "--type=service", "--all", "--no-pager"];
  let units: ServiceUnit[];
  try {
    units = parseSystemctlJson((await exec("systemctl", [...base, "--output=json"])).stdout);
  } catch {
    units = parseSystemctlPlain((await exec("systemctl", [...base, "--plain", "--no-legend"])).stdout);
  }
  return filterState(units, state).sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- logs

/** A unit name is passed to journalctl as an argument; it must not look like a flag. */
export function validUnit(unit: string): boolean {
  return /^[A-Za-z0-9@._:\\-]+$/.test(unit) && !unit.startsWith("-");
}

function journalString(value: unknown): string {
  if (typeof value === "string") return value;
  // journald encodes non-UTF-8 fields as an array of byte values.
  if (Array.isArray(value)) return Buffer.from(value as number[]).toString("utf8");
  return "";
}

export function parseJournal(stdout: string): LogPage {
  const entries: LogEntry[] = [];
  let cursor: string | undefined;
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const us = Number(rec.__REALTIME_TIMESTAMP);
    const pid = Number(rec._PID);
    const unit = journalString(rec._SYSTEMD_UNIT) || journalString(rec.SYSLOG_IDENTIFIER);
    entries.push({
      ts: Number.isFinite(us) ? Math.floor(us / 1000) : 0,
      priority: Number.isFinite(Number(rec.PRIORITY)) ? Number(rec.PRIORITY) : 6,
      message: journalString(rec.MESSAGE),
      ...(unit ? { unit } : {}),
      ...(Number.isFinite(pid) && pid > 0 ? { pid } : {}),
    });
    if (typeof rec.__CURSOR === "string") cursor = rec.__CURSOR;
  }
  return { entries, ...(cursor ? { cursor } : {}) };
}

export async function readLogs(input: {
  unit?: string;
  priority?: LogPriority;
  lines?: number;
  cursor?: string;
  scope?: ServiceScope;
}): Promise<LogPage> {
  const cap = await hostCapabilities();
  if (cap.logs !== "journald") throw new HttpError(404, "journal not available on this host");
  const lines = Math.min(MAX_LOG_LINES, Math.max(1, Math.floor(input.lines ?? 200)));
  const args = ["-o", "json", "--no-pager", "-n", String(lines)];
  if (input.scope === "user") args.push("--user");
  if (input.unit) {
    if (!validUnit(input.unit)) throw new HttpError(400, "invalid unit name");
    args.push(input.scope === "user" ? "--user-unit" : "-u", input.unit);
  }
  if (input.priority) args.push("-p", input.priority);
  if (input.cursor) {
    if (input.cursor.startsWith("-")) throw new HttpError(400, "invalid cursor");
    args.push(`--after-cursor=${input.cursor}`);
  }
  const page = parseJournal((await exec("journalctl", args)).stdout);
  // No new lines: keep the cursor the client already has.
  return page.cursor || !input.cursor ? page : { ...page, cursor: input.cursor };
}

// ---------------------------------------------------------------- files

function entryType(st: { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }): FileEntryType {
  if (st.isSymbolicLink()) return "link";
  if (st.isDirectory()) return "dir";
  if (st.isFile()) return "file";
  return "other";
}

/**
 * Resolve a requested path and refuse Glassys's own data directory: it holds
 * the operator password hash, the session secret and adapter keys, which the
 * views must never be able to show.
 */
async function guardedPath(raw: string): Promise<string> {
  if (!raw || !isAbsolute(raw)) throw new HttpError(400, "path must be absolute");
  const target = resolve(raw);
  let real: string;
  try {
    real = await realpath(target);
  } catch {
    throw new HttpError(404, "not found");
  }
  let data: string;
  try {
    data = await realpath(defaultDataDir());
  } catch {
    data = resolve(defaultDataDir());
  }
  if (real === data || real.startsWith(data + sep)) throw new HttpError(403, "the Glassys data directory is not browsable");
  return real;
}

export async function listDir(raw: string): Promise<DirListing> {
  const dir = await guardedPath(raw);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOTDIR") throw new HttpError(400, "not a directory");
    if (code === "EACCES" || code === "EPERM") throw new HttpError(403, "permission denied");
    throw new HttpError(404, "not found");
  }
  const truncated = names.length > MAX_DIR_ENTRIES;
  const entries: FileEntry[] = [];
  for (const name of names.slice(0, MAX_DIR_ENTRIES)) {
    try {
      const st = await lstat(join(dir, name));
      entries.push({ name, type: entryType(st), size: st.size, mtime: Math.floor(st.mtimeMs), mode: st.mode & 0o7777 });
    } catch {
      entries.push({ name, type: "other", size: 0, mtime: 0, mode: 0 });
    }
  }
  entries.sort((a, b) => {
    const da = a.type === "dir" ? 0 : 1;
    const db = b.type === "dir" ? 0 : 1;
    return da - db || a.name.localeCompare(b.name);
  });
  const parent = dirname(dir);
  return { path: dir, parent: parent === dir ? null : parent, entries, truncated };
}

export async function previewFile(raw: string): Promise<FilePreview> {
  const file = await guardedPath(raw);
  const st = await lstat(file);
  if (st.isDirectory()) throw new HttpError(400, "is a directory");
  if (!st.isFile()) throw new HttpError(400, "not a regular file");
  let handle;
  try {
    handle = await open(file, "r");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") throw new HttpError(403, "permission denied");
    throw new HttpError(404, "not found");
  }
  try {
    const length = Math.min(st.size, MAX_PREVIEW_BYTES);
    const buf = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buf, 0, length, 0);
    const head = buf.subarray(0, bytesRead);
    const binary = head.subarray(0, 8192).includes(0);
    return {
      path: file,
      size: st.size,
      binary,
      truncated: st.size > bytesRead,
      ...(binary ? {} : { text: head.toString("utf8") }),
    };
  } finally {
    await handle.close();
  }
}
