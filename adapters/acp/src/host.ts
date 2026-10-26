import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, readlink, realpath, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  PROTECTED_PATH_DENIAL,
  asRecord,
  commandTouchesProtectedPath,
  isProtectedPath,
  toolKindFromName,
} from "@glassys/adapter-contract";
import { optionAutoRun } from "@glassys/protocol";

export const MAX_ACP_READ_BYTES = 1_048_576;
export const TERMINAL_KILL_GRACE_MS = 3_000;

const READISH_KINDS = new Set(["read", "grep", "glob", "ls"]);

/**
 * With auto-run off, only reads are allowed, judged by the call's `kind`. A call without one is
 * denied: its title is free text ("Edit readfile.ts"), and guessing from it fails open.
 */
export function acpPermissionAllow(toolCall: unknown): boolean {
  const rec = asRecord(toolCall) ?? {};
  const raw = typeof rec.kind === "string" ? rec.kind.trim() : "";
  if (!raw) return false;
  return READISH_KINDS.has(toolKindFromName(raw));
}

const PATH_KEYS = ["path", "file_path", "filePath", "abs_path", "absolutePath", "notebook_path"] as const;

/** Paths and commands a permission request says the call will touch. */
function permissionTargets(toolCall: unknown): { paths: string[]; commands: string[] } {
  const rec = asRecord(toolCall) ?? {};
  const paths: string[] = [];
  const commands: string[] = [];
  if (Array.isArray(rec.locations)) {
    for (const loc of rec.locations) {
      const path = asRecord(loc)?.path;
      if (typeof path === "string") paths.push(path);
    }
  }
  const input = asRecord(rec.rawInput);
  if (input) {
    for (const key of PATH_KEYS) if (typeof input[key] === "string") paths.push(input[key] as string);
    const cmd = input.command;
    if (typeof cmd === "string") commands.push(cmd);
    else if (Array.isArray(cmd)) commands.push(cmd.map(String).join(" "));
  }
  return { paths, commands };
}

/** Does the call name Glassys's own data (or another protected path)? Then no mode allows it. */
export function acpPermissionTouchesProtected(toolCall: unknown, cwd: string, protectedPaths: readonly string[]): boolean {
  if (!protectedPaths.length) return false;
  const { paths, commands } = permissionTargets(toolCall);
  return (
    paths.some((p) => isProtectedPath(p, cwd, protectedPaths)) ||
    commands.some((c) => commandTouchesProtectedPath(c, cwd, protectedPaths))
  );
}

function insideRoot(root: string, abs: string): boolean {
  const rel = relative(root, abs);
  if (rel === "..") return false;
  if (rel.startsWith(`..${sep}`)) return false;
  if (rel && isAbsolute(rel)) return false;
  return true;
}

export function resolveInsideCwd(cwd: string, path: string): string {
  const root = resolve(cwd);
  const abs = resolve(root, path);
  if (!insideRoot(root, abs)) throw new Error("Path is outside the workspace");
  return abs;
}

const MAX_LINK_HOPS = 40;

async function nearestRealPath(abs: string, hops = 0): Promise<string> {
  let cur = abs;
  const tail: string[] = [];
  for (;;) {
    try {
      const real = await realpath(cur);
      return tail.length ? resolve(real, ...tail.reverse()) : real;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw err;
      /* A dangling link: realpath fails on it, yet a write through it lands where it points. */
      if (await lstat(cur).then((st) => st.isSymbolicLink(), () => false)) {
        if (hops >= MAX_LINK_HOPS) throw new Error("Too many symbolic links");
        const real = await nearestRealPath(resolve(dirname(cur), await readlink(cur)), hops + 1);
        return tail.length ? resolve(real, ...tail.reverse()) : real;
      }
      const parent = dirname(cur);
      if (parent === cur) return abs;
      tail.push(cur.slice(parent.length).replace(/^[\\/]+/, ""));
      cur = parent;
    }
  }
}

/** Lexical check plus the same check on real paths, so a symlink inside the workspace cannot lead out of it. */
export async function resolveRealInsideCwd(cwd: string, path: string): Promise<string> {
  const abs = resolveInsideCwd(cwd, path);
  const root = await nearestRealPath(resolve(cwd));
  const real = await nearestRealPath(abs);
  if (!insideRoot(root, real)) throw new Error("Path is outside the workspace");
  return abs;
}

/** Workspace check, then refuse the Glassys data dir even when it sits inside the workspace. */
export async function resolveAllowedPath(cwd: string, path: string, protectedPaths: readonly string[] = []): Promise<string> {
  const abs = await resolveRealInsideCwd(cwd, path);
  if (protectedPaths.length) {
    const real = await nearestRealPath(abs);
    if (isProtectedPath(abs, cwd, protectedPaths) || isProtectedPath(real, cwd, protectedPaths)) {
      throw new Error(PROTECTED_PATH_DENIAL);
    }
  }
  return abs;
}

/** A child spawned in its own process group, so killing the group reaches what it started too. */
const OWN_GROUP = process.platform !== "win32";

function signalTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (OWN_GROUP && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      /* group already gone; fall through to the child itself */
    }
  }
  child.kill(signal);
}

function killWithGrace(child: ChildProcess): void {
  if (child.exitCode != null || child.signalCode) return;
  try {
    signalTree(child, "SIGTERM");
  } catch {
    return;
  }
  const timer = setTimeout(() => {
    if (child.exitCode == null && !child.signalCode) {
      try {
        signalTree(child, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }, TERMINAL_KILL_GRACE_MS);
  timer.unref();
}

type ExitStatus = { exitCode: number | null; signal: string | null };

type Terminal = {
  child: ChildProcess;
  exit: ExitStatus | null;
  waiters: Array<(status: ExitStatus) => void>;
  output: string;
  truncated: boolean;
  limit: number;
};

/** What ACP calls the permission choices; agents name their own option ids. */
type PermissionKind = "allow_once" | "allow_always" | "reject_once" | "reject_always";

/**
 * The option the agent offered for this decision. ACP agents define their own `optionId`s, so
 * the choice is made by `kind`; an agent that sends no options gets the legacy id.
 */
export function acpPermissionChoice(params: unknown, allow: boolean): { outcome: Record<string, unknown> } {
  const rec = asRecord(params) ?? {};
  const options = Array.isArray(rec.options) ? rec.options.map((o) => asRecord(o)).filter(Boolean) : [];
  const order: PermissionKind[] = allow ? ["allow_once", "allow_always"] : ["reject_once", "reject_always"];
  for (const kind of order) {
    const hit = options.find((o) => o!.kind === kind && typeof o!.optionId === "string");
    if (hit) return { outcome: { outcome: "selected", optionId: hit.optionId } };
  }
  if (!options.length && allow) return { outcome: { outcome: "selected", optionId: "allow-once" } };
  /* Nothing to reject with: ending the request is the only refusal left. */
  return { outcome: { outcome: "cancelled" } };
}

export const DEFAULT_TERMINAL_OUTPUT_BYTES = 100_000;

/** Released terminals whose output is kept for the call that embedded them. */
const KEPT_TERMINAL_OUTPUTS = 32;

/**
 * What the host did that the agent's own updates may not say. Agents report a refused call as
 * "failed" or "cancelled" in their own words, and many embed a terminal by id instead of
 * copying its output into the call.
 */
export type HostLedger = { denied: Set<string>; output: Map<string, string> };

/** Every refusal the host itself throws says this, so a call that failed on one reads as denied. */
export const HOST_DENIAL_MARK = "Glassys denied";

export function hostLedger(): HostLedger {
  return { denied: new Set(), output: new Map() };
}

function envFrom(raw: unknown): NodeJS.ProcessEnv | undefined {
  if (!Array.isArray(raw)) return undefined;
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const item of raw) {
    const rec = asRecord(item);
    if (rec && typeof rec.name === "string" && typeof rec.value === "string") env[rec.name] = rec.value;
  }
  return env;
}

/** `line` is 1-based; `limit` is a line count. */
async function readLines(abs: string, line: number | undefined, limit: number | undefined): Promise<string> {
  const first = Math.max(1, line ?? 1);
  const out: string[] = [];
  let bytes = 0;
  let n = 0;
  const lines = createInterface({ input: createReadStream(abs, { encoding: "utf8" }), crlfDelay: Infinity });
  try {
    for await (const text of lines) {
      n += 1;
      if (n < first) continue;
      if (limit !== undefined && out.length >= limit) break;
      bytes += Buffer.byteLength(text) + 1;
      if (bytes > MAX_ACP_READ_BYTES) throw new Error(`Requested range is larger than ${MAX_ACP_READ_BYTES} bytes`);
      out.push(text);
    }
  } finally {
    lines.close();
  }
  return out.join("\n");
}

function positiveInt(v: unknown): number | undefined {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : undefined;
}

export function registerHostHandlers(
  rpc: { handle: (method: string, fn: (params: unknown) => Promise<unknown> | unknown) => void },
  cwd: string,
  options: Record<string, unknown>,
  protectedPaths: readonly string[] = [],
  ledger: HostLedger = hostLedger(),
) {
  const autoRun = optionAutoRun(options);

  rpc.handle("fs/read_text_file", async (params) => {
    const rec = asRecord(params) ?? {};
    const path = typeof rec.path === "string" ? rec.path : "";
    const abs = await resolveAllowedPath(cwd, path, protectedPaths);
    const line = positiveInt(rec.line);
    const limit = positiveInt(rec.limit);
    if (line !== undefined || limit !== undefined) return { content: await readLines(abs, line, limit) };
    const info = await stat(abs);
    if (info.size > MAX_ACP_READ_BYTES) {
      throw new Error(`File is larger than ${MAX_ACP_READ_BYTES} bytes; read it by line range`);
    }
    const content = await readFile(abs, "utf8");
    return { content };
  });

  rpc.handle("fs/write_text_file", async (params) => {
    if (!autoRun) throw new Error(`Auto-run is off; ${HOST_DENIAL_MARK} this write`);
    const rec = asRecord(params) ?? {};
    const path = typeof rec.path === "string" ? rec.path : "";
    /* A request without content would empty the file. */
    if (typeof rec.content !== "string") throw new Error("fs/write_text_file needs content");
    const content = rec.content;
    const abs = await resolveAllowedPath(cwd, path, protectedPaths);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
    return {};
  });

  rpc.handle("session/request_permission", async (params) => {
    const rec = asRecord(params) ?? {};
    const touchesProtected = acpPermissionTouchesProtected(rec.toolCall, cwd, protectedPaths);
    if (autoRun && !touchesProtected) return acpPermissionChoice(params, true);
    const allow = !touchesProtected && acpPermissionAllow(rec.toolCall);
    const callId = asRecord(rec.toolCall)?.toolCallId;
    if (!allow && typeof callId === "string") ledger.denied.add(callId);
    return acpPermissionChoice(params, allow);
  });

  const terminals = new Map<string, Terminal>();

  const settle = (term: Terminal, status: ExitStatus) => {
    if (term.exit) return;
    term.exit = status;
    for (const done of term.waiters.splice(0)) done(status);
  };

  const lookup = (params: unknown): Terminal => {
    const rec = asRecord(params) ?? {};
    const term = terminals.get(String(rec.terminalId ?? ""));
    if (!term) throw new Error("Unknown terminal");
    return term;
  };

  rpc.handle("terminal/create", async (params) => {
    if (!autoRun) throw new Error(`Auto-run is off; ${HOST_DENIAL_MARK} this terminal`);
    const rec = asRecord(params) ?? {};
    if (typeof rec.command !== "string" || !rec.command.trim()) throw new Error("terminal/create needs a command");
    const command = rec.command;
    const args = Array.isArray(rec.args) ? rec.args.map(String) : [];
    if (commandTouchesProtectedPath([command, ...args].join(" "), cwd, protectedPaths)) {
      throw new Error(PROTECTED_PATH_DENIAL);
    }
    const termCwd = typeof rec.cwd === "string" && rec.cwd ? await resolveAllowedPath(cwd, rec.cwd, protectedPaths) : cwd;
    const limit = positiveInt(rec.outputByteLimit) ?? DEFAULT_TERMINAL_OUTPUT_BYTES;
    const id = `term-${randomUUID()}`;
    const child = spawn(command, args, {
      cwd: termCwd,
      env: envFrom(rec.env),
      stdio: ["pipe", "pipe", "pipe"],
      detached: OWN_GROUP,
    });
    const term: Terminal = { child, exit: null, waiters: [], output: "", truncated: false, limit };
    const append = (chunk: Buffer | string) => {
      const next = term.output + chunk.toString();
      if (Buffer.byteLength(next) > term.limit) {
        /* Keep the tail, cut at a character boundary. */
        const buf = Buffer.from(next);
        term.output = buf.subarray(buf.length - term.limit).toString("utf8").replace(/^�+/, "");
        term.truncated = true;
      } else term.output = next;
      ledger.output.delete(id);
      ledger.output.set(id, term.output);
      if (ledger.output.size > KEPT_TERMINAL_OUTPUTS) ledger.output.delete(ledger.output.keys().next().value!);
    };
    /* Decode per stream, so a multi-byte character split across chunks is not mangled. */
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.stdin?.on("error", () => undefined);
    child.on("error", (err) => {
      append(`${err.message}\n`);
      settle(term, { exitCode: 127, signal: null });
    });
    child.on("close", (code, signal) => settle(term, { exitCode: code, signal: signal ?? null }));
    terminals.set(id, term);
    return { terminalId: id };
  });
  rpc.handle("terminal/output", async (params) => {
    const term = lookup(params);
    return { output: term.output, truncated: term.truncated, ...(term.exit ? { exitStatus: term.exit } : {}) };
  });
  rpc.handle("terminal/wait_for_exit", async (params) => {
    const term = lookup(params);
    if (term.exit) return term.exit;
    return new Promise<ExitStatus>((resolveWait) => term.waiters.push(resolveWait));
  });
  /* Kill stops the command but keeps the terminal readable until the agent releases it. */
  rpc.handle("terminal/kill", async (params) => {
    killWithGrace(lookup(params).child);
    return {};
  });
  rpc.handle("terminal/release", async (params) => {
    const rec = asRecord(params) ?? {};
    const id = String(rec.terminalId ?? "");
    const term = terminals.get(id);
    if (!term) return {};
    killWithGrace(term.child);
    settle(term, { exitCode: null, signal: "SIGTERM" });
    terminals.delete(id);
    return {};
  });

  return () => {
    for (const term of terminals.values()) {
      killWithGrace(term.child);
      settle(term, { exitCode: null, signal: "SIGTERM" });
    }
    terminals.clear();
  };
}
