import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { registerHostHandlers, resolveInsideCwd } from "./host.js";

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
});
