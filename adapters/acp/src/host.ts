import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { asRecord, toolKindFromName } from "@glassys/adapter-contract";
import { optionBool } from "@glassys/protocol";

export const MAX_ACP_READ_BYTES = 1_048_576;
export const TERMINAL_KILL_GRACE_MS = 3_000;

const READISH_KINDS = new Set(["read", "grep", "glob", "ls"]);

export function acpPermissionAllow(toolCall: unknown): boolean {
  const rec = asRecord(toolCall) ?? {};
  const raw = String(rec.kind ?? rec.title ?? rec.name ?? "").trim();
  if (!raw) return false;
  return READISH_KINDS.has(toolKindFromName(raw));
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

async function nearestRealPath(abs: string): Promise<string> {
  let cur = abs;
  const tail: string[] = [];
  for (;;) {
    try {
      const real = await realpath(cur);
      return tail.length ? resolve(real, ...tail.reverse()) : real;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw err;
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

function killWithGrace(child: ChildProcess): void {
  if (child.exitCode != null || child.signalCode) return;
  try {
    child.kill("SIGTERM");
  } catch {
    return;
  }
  const timer = setTimeout(() => {
    if (child.exitCode == null && !child.signalCode) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }, TERMINAL_KILL_GRACE_MS);
  timer.unref();
}

type Terminal = {
  child: ChildProcess;
  exitCode: number | null;
  waiters: Array<(code: number) => void>;
};

export function registerHostHandlers(
  rpc: { handle: (method: string, fn: (params: unknown) => Promise<unknown> | unknown) => void },
  cwd: string,
  options: Record<string, unknown>,
) {
  const autoRun = optionBool(options, "autoRun", true);

  rpc.handle("fs/read_text_file", async (params) => {
    const rec = asRecord(params) ?? {};
    const path = typeof rec.path === "string" ? rec.path : "";
    const abs = await resolveRealInsideCwd(cwd, path);
    const info = await stat(abs);
    if (info.size > MAX_ACP_READ_BYTES) {
      throw new Error(`File is larger than ${MAX_ACP_READ_BYTES} bytes`);
    }
    const content = await readFile(abs, "utf8");
    return { content };
  });

  rpc.handle("fs/write_text_file", async (params) => {
    if (!autoRun) throw new Error("Auto-run is off; Glassys denied this write");
    const rec = asRecord(params) ?? {};
    const path = typeof rec.path === "string" ? rec.path : "";
    const content = typeof rec.content === "string" ? rec.content : "";
    const abs = await resolveRealInsideCwd(cwd, path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
    return {};
  });

  rpc.handle("session/request_permission", async (params) => {
    if (autoRun) return { outcome: { outcome: "selected", optionId: "allow-once" } };
    const rec = asRecord(params) ?? {};
    if (acpPermissionAllow(rec.toolCall)) return { outcome: { outcome: "selected", optionId: "allow-once" } };
    return { outcome: { outcome: "cancelled" } };
  });

  const terminals = new Map<string, Terminal>();
  const outputs = new Map<string, string>();
  const MAX_OUTPUT = 100_000;

  const settle = (term: Terminal, code: number) => {
    if (term.exitCode != null) return;
    term.exitCode = code;
    for (const done of term.waiters.splice(0)) done(code);
  };

  rpc.handle("terminal/create", (params) => {
    if (!autoRun) throw new Error("Auto-run is off; Glassys denied this terminal");
    const rec = asRecord(params) ?? {};
    const command = typeof rec.command === "string" ? rec.command : "bash";
    const args = Array.isArray(rec.args) ? rec.args.map(String) : [];
    const id = `term-${randomUUID()}`;
    const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    const term: Terminal = { child, exitCode: null, waiters: [] };
    outputs.set(id, "");
    const append = (chunk: Buffer | string) => {
      const next = (outputs.get(id) ?? "") + chunk.toString();
      outputs.set(id, next.length > MAX_OUTPUT ? next.slice(-MAX_OUTPUT) : next);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.stdin?.on("error", () => undefined);
    child.on("error", (err) => {
      append(`${err.message}\n`);
      settle(term, 127);
    });
    child.on("close", (code) => settle(term, code ?? 1));
    terminals.set(id, term);
    return { terminalId: id };
  });
  rpc.handle("terminal/output", async (params) => {
    const rec = asRecord(params) ?? {};
    const id = String(rec.terminalId ?? "");
    const output = outputs.get(id) ?? "";
    return { output, truncated: output.length >= MAX_OUTPUT };
  });
  rpc.handle("terminal/wait_for_exit", async (params) => {
    const rec = asRecord(params) ?? {};
    const id = String(rec.terminalId ?? "");
    const term = terminals.get(id);
    if (!term) return { exitCode: 0 };
    if (term.exitCode != null) return { exitCode: term.exitCode };
    const code = await new Promise<number>((resolveWait) => term.waiters.push(resolveWait));
    return { exitCode: code };
  });
  const release = (id: string) => {
    const term = terminals.get(id);
    if (!term) return;
    killWithGrace(term.child);
    settle(term, 1);
    terminals.delete(id);
  };
  rpc.handle("terminal/kill", (params) => {
    const rec = asRecord(params) ?? {};
    release(String(rec.terminalId ?? ""));
    return {};
  });
  rpc.handle("terminal/release", (params) => {
    const rec = asRecord(params) ?? {};
    const id = String(rec.terminalId ?? "");
    release(id);
    outputs.delete(id);
    return {};
  });

  return () => {
    for (const id of [...terminals.keys()]) release(id);
    terminals.clear();
    outputs.clear();
  };
}
