import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, readFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { spawn } from "node:child_process";
import { createMutex } from "./lock.js";
import { PROTOCOL_VERSION } from "@glassys/protocol";
import { writeFileAtomic } from "./atomic.js";
import { GATEWAY_VERSION, repoRoot, runningBuild } from "./build-info.js";
import { paths, log } from "./paths.js";
import { HttpError } from "./errors.js";

const SERVICE_LABEL = "dev.kn990x.glassys";
const SYSTEMD_UNIT = "glassys.service";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 10_000;

export type ServiceKind = "launchd" | "systemd" | "none";
export type UpgradePhase = "idle" | "starting" | "pulling" | "install" | "build" | "restart" | "error";

let detectOverride: ServiceKind | null = null;
let gitInfoOverride: { sha: string; branch: string; dirty: boolean } | null | undefined;

export function setDetectServiceForTests(kind: ServiceKind | null): void {
  detectOverride = kind;
}

export function setInstallGitForTests(info: { sha: string; branch: string; dirty: boolean } | null | undefined): void {
  gitInfoOverride = info;
}

export interface UpgradeStatus {
  phase: UpgradePhase;
  error?: string;
  /** Set once per upgrade run; every later phase keeps it. */
  startedAt?: string;
  updatedAt?: string;
  fromSha?: string;
  /** The commit the restarted gateway must report. */
  targetSha?: string;
  /** The upgrade script's pid while it runs (written by scripts/host-service.mjs). */
  pid?: number;
}

const ACTIVE_PHASES: ReadonlySet<UpgradePhase> = new Set(["starting", "pulling", "install", "build"]);
/** The gateway wrote "starting" but the script never reported in. */
const STARTING_STALE_MS = 2 * 60_000;
/** The restart was requested but no new gateway closed the run. */
const RESTART_STALE_MS = 5 * 60_000;
/** A live script that has not moved for this long (a hung install) is given up on. */
const ACTIVE_STALE_MS = 60 * 60_000;

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    /* EPERM: it exists, it is just not ours. */
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

let pidAliveImpl = pidAlive;

export function setPidAliveForTests(fn: ((pid: number) => boolean) | null): void {
  pidAliveImpl = fn ?? pidAlive;
}

/**
 * Why an unfinished upgrade can no longer finish, or undefined while it still can. Without this a
 * script killed mid-build (OOM, a host reboot) left its phase behind for good, and every later
 * upgrade was refused as "already running".
 */
export function stalledUpgradeReason(
  status: UpgradeStatus,
  now = Date.now(),
  isAlive: (pid: number) => boolean = pidAliveImpl,
): string | undefined {
  const last = Date.parse(status.updatedAt || status.startedAt || "");
  const age = Number.isNaN(last) ? Number.POSITIVE_INFINITY : now - last;
  if (status.phase === "restart") {
    return age > RESTART_STALE_MS ? "The gateway did not come back on the new version after the restart" : undefined;
  }
  if (!ACTIVE_PHASES.has(status.phase)) return undefined;
  if (typeof status.pid === "number" && status.pid > 0) {
    if (!isAlive(status.pid)) return `The upgrade stopped during "${status.phase}" without finishing`;
    return age > ACTIVE_STALE_MS ? `The upgrade made no progress during "${status.phase}" for an hour` : undefined;
  }
  return age > STARTING_STALE_MS ? "The upgrade script did not start" : undefined;
}

/** The current status, with a run that can no longer finish recorded as an error. */
export async function currentUpgradeStatus(): Promise<UpgradeStatus> {
  const cur = await readUpgradeStatus();
  const reason = stalledUpgradeReason(cur);
  if (!reason) return cur;
  log("warn", "upgrade stalled", { phase: cur.phase, reason });
  const next: UpgradeStatus = { ...cur, phase: "error", error: reason };
  delete next.pid;
  await writeUpgradeStatus(next);
  return next;
}

/** What the probe found for this process (it does not change while the gateway runs). */
let detected: ServiceKind | null = null;

async function exitsZero(cmd: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(cmd, args, { timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Which service manager runs this gateway. Asynchronous: this used to be spawnSync on the request
 * path, which froze the event loop (and every token being streamed) for up to two seconds.
 */
export async function detectService(env = process.env, platform = process.platform): Promise<ServiceKind> {
  if (detectOverride) return detectOverride;
  if (env.GLASSYS_SERVICE === "1") {
    if (platform === "darwin") return "launchd";
    if (platform === "linux") return "systemd";
  }
  const cacheable = env === process.env && platform === process.platform;
  if (cacheable && detected) return detected;
  let kind: ServiceKind = "none";
  if (platform === "darwin" && (await exitsZero("launchctl", ["print", `gui/${process.getuid?.() ?? 0}/${SERVICE_LABEL}`]))) {
    kind = "launchd";
  } else if (platform === "linux" && (await exitsZero("systemctl", ["--user", "cat", SYSTEMD_UNIT]))) {
    kind = "systemd";
  }
  if (cacheable) detected = kind;
  return kind;
}

async function git(args: string[], timeout = GIT_TIMEOUT_MS): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repoRoot(), ...args], {
    timeout,
    windowsHide: true,
  });
  return stdout.trim();
}

export async function readInstallGit(): Promise<{ sha: string; branch: string; dirty: boolean } | undefined> {
  if (gitInfoOverride !== undefined) return gitInfoOverride ?? undefined;
  if (!existsSync(join(repoRoot(), ".git"))) return undefined;
  try {
    const sha = await git(["rev-parse", "HEAD"]);
    const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
    const dirty = (await git(["status", "--porcelain"])).length > 0;
    return { sha, branch, dirty };
  } catch {
    return undefined;
  }
}

export async function fetchBehind(): Promise<{ behind: number; sha: string; branch: string; dirty: boolean }> {
  const gitInfo = await readInstallGit();
  if (!gitInfo) throw new HttpError(400, "This install is not a git clone");
  try {
    await git(["fetch", "--quiet"], GIT_TIMEOUT_MS);
  } catch (err) {
    /* git's stderr can name the remote URL with credentials in it; keep it in the log. */
    log("warn", "git fetch failed", { error: String(err) });
    throw new HttpError(400, "git fetch failed");
  }
  let behind = 0;
  try {
    const n = await git(["rev-list", "--count", "HEAD..@{u}"]);
    behind = Number.parseInt(n, 10) || 0;
  } catch {
    behind = 0;
  }
  const latest = await readInstallGit();
  return { behind, sha: latest?.sha || gitInfo.sha, branch: latest?.branch || gitInfo.branch, dirty: latest?.dirty ?? gitInfo.dirty };
}

export async function readUpgradeStatus(): Promise<UpgradeStatus> {
  try {
    return JSON.parse(await readFile(paths.upgradeStatus(), "utf8")) as UpgradeStatus;
  } catch {
    return { phase: "idle" };
  }
}

export async function writeUpgradeStatus(status: UpgradeStatus): Promise<void> {
  await mkdir(dirname(paths.upgradeStatus()), { recursive: true, mode: 0o700 });
  /* Temp file + rename: a file left 0664 by an older upgrade script is replaced, not kept. */
  await writeFileAtomic(paths.upgradeStatus(), JSON.stringify({ ...status, updatedAt: new Date().toISOString() }, null, 2));
}

/**
 * On systemd the upgrade script lives in the unit's cgroup, so the restart it asks for also
 * kills it before it can report the outcome. The new process closes the run instead: it is
 * the proof the restart happened, and its commit says whether it is the code that was built.
 */
export async function reconcileUpgradeStatus(): Promise<void> {
  /* A restart is closed by this very start however long it took; anything else may have died. */
  const cur = await readUpgradeStatus();
  if (cur.phase !== "restart") {
    await currentUpgradeStatus();
    return;
  }
  const { commit } = runningBuild();
  if (cur.targetSha && commit && cur.targetSha !== commit) {
    const error = `Restarted on ${commit.slice(0, 7)}, expected ${cur.targetSha.slice(0, 7)}`;
    log("warn", "upgrade restart came back on another commit", { expected: cur.targetSha, running: commit });
    const failed: UpgradeStatus = { ...cur, phase: "error", error };
    delete failed.pid;
    await writeUpgradeStatus(failed);
    return;
  }
  log("info", "upgrade finished", { commit });
  const done: UpgradeStatus = { ...cur, phase: "idle" };
  delete done.error;
  delete done.pid;
  await writeUpgradeStatus(done);
}

export async function adminUpdateSnapshot(): Promise<{
  version: string;
  protocolVersion: number;
  git?: { sha: string; branch: string; dirty: boolean };
  running: { commit?: string; startedAt: string };
  service: ServiceKind;
  upgrading?: UpgradeStatus;
}> {
  const gitInfo = await readInstallGit();
  const upgrading = await currentUpgradeStatus();
  return {
    version: GATEWAY_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    ...(gitInfo ? { git: gitInfo } : {}),
    running: runningBuild(),
    service: await detectService(),
    ...(upgrading.phase !== "idle" ? { upgrading } : {}),
  };
}

let spawnUpgrade = spawn;

export function setUpgradeSpawnForTests(fn: typeof spawn | null): void {
  spawnUpgrade = fn ?? spawn;
}

/** One upgrade start at a time: two requests both read "idle" and both spawned a script. */
const withUpgradeStart = createMutex();

export async function startUpgrade(): Promise<void> {
  return withUpgradeStart(startUpgradeUnlocked);
}

async function startUpgradeUnlocked(): Promise<void> {
  const service = await detectService();
  if (service === "none") {
    throw new HttpError(409, "Upgrade from the PWA needs the user service (pnpm run service:install). Use pnpm run service:upgrade in the clone.");
  }
  const gitInfo = await readInstallGit();
  if (gitInfo?.dirty) {
    throw new HttpError(409, "Working tree is dirty");
  }
  const cur = await currentUpgradeStatus();
  if (cur.phase !== "idle" && cur.phase !== "error") {
    throw new HttpError(409, "An upgrade is already running");
  }
  const startedAt = new Date().toISOString();
  await writeUpgradeStatus({ phase: "starting", startedAt, ...(gitInfo ? { fromSha: gitInfo.sha } : {}) });
  const script = join(repoRoot(), "scripts", "host-service.mjs");
  const logPath = paths.upgradeLog();
  await mkdir(dirname(logPath), { recursive: true, mode: 0o700 });
  const fs = await import("node:fs");
  const out = fs.openSync(logPath, "a", 0o600);
  /* The mode above only applies on create; a log left by an older build is tightened here. */
  await chmod(logPath, 0o600).catch(() => undefined);
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawnUpgrade(process.execPath, [script, "upgrade"], {
        cwd: repoRoot(),
        detached: true,
        stdio: ["ignore", out, out],
        env: { ...process.env, GLASSYS_UPGRADE_STRICT: "1", GLASSYS_UPGRADE_STARTED_AT: startedAt },
      });
      const fail = (err: Error) => {
        try {
          fs.closeSync(out);
        } catch {
          /* already closed */
        }
        reject(err);
      };
      child.once("error", fail);
      child.once("spawn", () => {
        child.removeListener("error", fail);
        try {
          fs.closeSync(out);
        } catch {
          /* already closed */
        }
        child.unref();
        resolve();
      });
    });
    log("info", "upgrade spawned");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeUpgradeStatus({ phase: "error", error: message, startedAt });
    throw new HttpError(500, message);
  }
}
