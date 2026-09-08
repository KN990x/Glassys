import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { asRecord } from "@glassys/adapter-contract";
import { optionBool } from "@glassys/protocol";

export const MAX_ACP_READ_BYTES = 1_048_576;

export function resolveInsideCwd(cwd: string, path: string): string {
  const root = resolve(cwd);
  const abs = resolve(root, path);
  const rel = relative(root, abs);
  if (rel === "..") throw new Error("Path is outside the workspace");
  if (rel.startsWith(`..${sep}`)) throw new Error("Path is outside the workspace");
  if (rel && isAbsolute(rel)) throw new Error("Path is outside the workspace");
  return abs;
}

export function registerHostHandlers(
  rpc: { handle: (method: string, fn: (params: unknown) => Promise<unknown> | unknown) => void },
  cwd: string,
  options: Record<string, unknown>,
) {
  const autoRun = optionBool(options, "autoRun", true);

  rpc.handle("fs/read_text_file", async (params) => {
    const rec = asRecord(params) ?? {};
    const path = typeof rec.path === "string" ? rec.path : "";
    const abs = resolveInsideCwd(cwd, path);
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
    const abs = resolveInsideCwd(cwd, path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
    return {};
  });

  rpc.handle("session/request_permission", async (params) => {
    if (autoRun) return { outcome: { outcome: "selected", optionId: "allow-once" } };
    const rec = asRecord(params) ?? {};
    const tool = String(asRecord(rec.toolCall)?.kind ?? asRecord(rec.toolCall)?.title ?? "");
    const readish = /read|grep|glob|ls|search/i.test(tool);
    if (readish) return { outcome: { outcome: "selected", optionId: "allow-once" } };
    return { outcome: { outcome: "cancelled" } };
  });

  const terminals = new Map<string, ReturnType<typeof spawn>>();
  const outputs = new Map<string, string>();
  const MAX_OUTPUT = 100_000;

  rpc.handle("terminal/create", (params) => {
    if (!autoRun) throw new Error("Auto-run is off; Glassys denied this terminal");
    const rec = asRecord(params) ?? {};
    const command = typeof rec.command === "string" ? rec.command : "bash";
    const args = Array.isArray(rec.args) ? rec.args.map(String) : [];
    const id = `term-${Date.now()}`;
    const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    outputs.set(id, "");
    const append = (chunk: Buffer) => {
      const next = (outputs.get(id) ?? "") + chunk.toString("utf8");
      outputs.set(id, next.length > MAX_OUTPUT ? next.slice(-MAX_OUTPUT) : next);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    terminals.set(id, child);
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
    const child = terminals.get(id);
    if (!child) return { exitCode: 0 };
    const code = await new Promise<number>((resolveWait) => child.on("close", (c) => resolveWait(c ?? 0)));
    return { exitCode: code };
  });
  rpc.handle("terminal/kill", (params) => {
    const rec = asRecord(params) ?? {};
    const id = String(rec.terminalId ?? "");
    terminals.get(id)?.kill("SIGTERM");
    terminals.delete(id);
    return {};
  });
  rpc.handle("terminal/release", (params) => {
    const rec = asRecord(params) ?? {};
    const id = String(rec.terminalId ?? "");
    terminals.get(id)?.kill("SIGTERM");
    terminals.delete(id);
    outputs.delete(id);
    return {};
  });

  return () => {
    for (const child of terminals.values()) {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }
    terminals.clear();
    outputs.clear();
  };
}
