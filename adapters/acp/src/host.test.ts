import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_ACP_READ_BYTES, registerHostHandlers, resolveInsideCwd, resolveRealInsideCwd } from "./host.js";

describe("resolveRealInsideCwd", () => {
  it("rejects a symlink inside the workspace that points out of it", async () => {
    const outside = await mkdtemp(join(tmpdir(), "glassys-acp-out-"));
    await writeFile(join(outside, "secret.txt"), "x");
    const ws = await mkdtemp(join(tmpdir(), "glassys-acp-ws-"));
    await symlink(outside, join(ws, "link"));
    await expect(resolveRealInsideCwd(ws, "link/secret.txt")).rejects.toThrow(/outside/);
    await expect(resolveRealInsideCwd(ws, "link/new/file.txt")).rejects.toThrow(/outside/);
  });

  it("allows real paths and files that do not exist yet", async () => {
    const ws = await mkdtemp(join(tmpdir(), "glassys-acp-ws-"));
    await mkdir(join(ws, "src"));
    await expect(resolveRealInsideCwd(ws, "src/a.ts")).resolves.toBe(join(ws, "src/a.ts"));
    await expect(resolveRealInsideCwd(ws, "new/dir/b.ts")).resolves.toBe(join(ws, "new/dir/b.ts"));
  });
});

describe("resolveInsideCwd", () => {
  const cwd = resolve("/tmp/glassys-ws");

  it("allows paths under cwd", () => {
    expect(resolveInsideCwd(cwd, "src/a.ts")).toBe(resolve(cwd, "src/a.ts"));
    expect(resolveInsideCwd(cwd, ".")).toBe(cwd);
  });

  it("rejects path escape", () => {
    expect(() => resolveInsideCwd(cwd, "../etc/passwd")).toThrow(/outside/);
    expect(() => resolveInsideCwd(cwd, "/etc/passwd")).toThrow(/outside/);
    expect(() => resolveInsideCwd(cwd, "src/../../etc/passwd")).toThrow(/outside/);
  });
});

describe("registerHostHandlers autoRun", () => {
  function handlers(autoRun: boolean) {
    const map = new Map<string, (params: unknown) => Promise<unknown> | unknown>();
    const rpc = {
      handle(method: string, fn: (params: unknown) => Promise<unknown> | unknown) {
        map.set(method, fn);
      },
    };
    const cleanup = registerHostHandlers(rpc, cwd, { autoRun });
    return { map, cleanup };
  }

  const cwd = resolve("/tmp/glassys-ws");

  it("denies writes and terminals when auto-run is off", async () => {
    const { map, cleanup } = handlers(false);
    try {
      await expect(map.get("fs/write_text_file")?.({ path: "a.ts", content: "x" })).rejects.toThrow(/Auto-run is off/);
      expect(() => map.get("terminal/create")?.({ command: "true" })).toThrow(/Auto-run is off/);
    } finally {
      cleanup();
    }
  });

  it("does not auto-allow write-ish names that substring-match read tools", async () => {
    const { map, cleanup } = handlers(false);
    try {
      await expect(map.get("session/request_permission")?.({ toolCall: { kind: "research" } })).resolves.toMatchObject({
        outcome: { outcome: "cancelled" },
      });
      await expect(map.get("session/request_permission")?.({ toolCall: { title: "already" } })).resolves.toMatchObject({
        outcome: { outcome: "cancelled" },
      });
      await expect(map.get("session/request_permission")?.({ toolCall: { kind: "search" } })).resolves.toMatchObject({
        outcome: { outcome: "selected" },
      });
    } finally {
      cleanup();
    }
  });

  it("refuses to read oversized files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-acp-"));
    const map = new Map<string, (params: unknown) => Promise<unknown> | unknown>();
    const rpc = {
      handle(method: string, fn: (params: unknown) => Promise<unknown> | unknown) {
        map.set(method, fn);
      },
    };
    const cleanup = registerHostHandlers(rpc, dir, { autoRun: true });
    try {
      const big = join(dir, "big.log");
      await writeFile(big, Buffer.alloc(MAX_ACP_READ_BYTES + 1));
      await expect(map.get("fs/read_text_file")?.({ path: "big.log" })).rejects.toThrow(/larger than/);
    } finally {
      cleanup();
    }
  });

  it("refuses the Glassys data dir even inside the workspace", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-acp-"));
    const data = join(dir, "glassys", "data");
    await mkdir(data, { recursive: true });
    await writeFile(join(data, "secrets.json"), "{}");
    await writeFile(join(dir, "notes.txt"), "ok");
    const map = new Map<string, (params: unknown) => Promise<unknown> | unknown>();
    const cleanup = registerHostHandlers({ handle: (m, fn) => void map.set(m, fn) }, dir, { autoRun: true }, [data]);
    try {
      await expect(map.get("fs/read_text_file")?.({ path: "glassys/data/secrets.json" })).rejects.toThrow(/denied/);
      await expect(map.get("fs/write_text_file")?.({ path: join(data, "x"), content: "" })).rejects.toThrow(/denied/);
      expect(() => map.get("terminal/create")?.({ command: "cat", args: [join(data, "secrets.json")] })).toThrow(/denied/);
      await expect(map.get("fs/read_text_file")?.({ path: "notes.txt" })).resolves.toEqual({ content: "ok" });
    } finally {
      cleanup();
    }
  });

  it("wait_for_exit returns when the child has already exited", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-acp-term-"));
    const map = new Map<string, (params: unknown) => Promise<unknown> | unknown>();
    const rpc = {
      handle(method: string, fn: (params: unknown) => Promise<unknown> | unknown) {
        map.set(method, fn);
      },
    };
    const cleanup = registerHostHandlers(rpc, dir, { autoRun: true });
    try {
      const created = map.get("terminal/create")?.({
        command: process.execPath,
        args: ["-e", "process.exit(7)"],
      }) as { terminalId: string };
      await new Promise((r) => setTimeout(r, 80));
      const result = await map.get("terminal/wait_for_exit")?.({ terminalId: created.terminalId });
      expect(result).toEqual({ exitCode: 7 });
    } finally {
      cleanup();
    }
  });

  it("reports a missing binary instead of crashing the process", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-acp-term-"));
    const map = new Map<string, (params: unknown) => Promise<unknown> | unknown>();
    const cleanup = registerHostHandlers({ handle: (m, fn) => void map.set(m, fn) }, dir, { autoRun: true });
    try {
      const created = map.get("terminal/create")?.({ command: "glassys-no-such-binary-xyz" }) as { terminalId: string };
      const result = (await map.get("terminal/wait_for_exit")?.({ terminalId: created.terminalId })) as {
        exitCode: number;
      };
      expect(result.exitCode).not.toBe(0);
      const out = (await map.get("terminal/output")?.({ terminalId: created.terminalId })) as { output: string };
      expect(out.output).toMatch(/ENOENT/);
    } finally {
      cleanup();
    }
  });

  it("gives every terminal its own id and settles waiters on dispose", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-acp-term-"));
    const map = new Map<string, (params: unknown) => Promise<unknown> | unknown>();
    const cleanup = registerHostHandlers({ handle: (m, fn) => void map.set(m, fn) }, dir, { autoRun: true });
    const args = ["-e", "setInterval(() => {}, 1000)"];
    const a = map.get("terminal/create")?.({ command: process.execPath, args }) as { terminalId: string };
    const b = map.get("terminal/create")?.({ command: process.execPath, args }) as { terminalId: string };
    expect(a.terminalId).not.toBe(b.terminalId);
    const waiting = map.get("terminal/wait_for_exit")?.({ terminalId: a.terminalId });
    cleanup();
    await expect(waiting).resolves.toMatchObject({ exitCode: expect.any(Number) });
  });
});
