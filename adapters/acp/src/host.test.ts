import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_ACP_READ_BYTES, registerHostHandlers, resolveInsideCwd } from "./host.js";

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

  it("allows permission for read-ish tools when auto-run is off", async () => {
    const { map, cleanup } = handlers(false);
    try {
      await expect(map.get("session/request_permission")?.({ toolCall: { kind: "read" } })).resolves.toMatchObject({
        outcome: { outcome: "selected" },
      });
      await expect(map.get("session/request_permission")?.({ toolCall: { kind: "edit" } })).resolves.toMatchObject({
        outcome: { outcome: "cancelled" },
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
});
