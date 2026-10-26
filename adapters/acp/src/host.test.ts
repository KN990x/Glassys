import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_ACP_READ_BYTES, acpPermissionChoice, hostLedger, registerHostHandlers, resolveInsideCwd, resolveRealInsideCwd } from "./host.js";

describe("resolveRealInsideCwd", () => {
  it("rejects a symlink inside the workspace that points out of it", async () => {
    const outside = await mkdtemp(join(tmpdir(), "glassys-acp-out-"));
    await writeFile(join(outside, "secret.txt"), "x");
    const ws = await mkdtemp(join(tmpdir(), "glassys-acp-ws-"));
    await symlink(outside, join(ws, "link"));
    await expect(resolveRealInsideCwd(ws, "link/secret.txt")).rejects.toThrow(/outside/);
    await expect(resolveRealInsideCwd(ws, "link/new/file.txt")).rejects.toThrow(/outside/);
  });

  it("rejects a dangling symlink that points out of the workspace", async () => {
    const outside = await mkdtemp(join(tmpdir(), "glassys-acp-out-"));
    const ws = await mkdtemp(join(tmpdir(), "glassys-acp-ws-"));
    await symlink(join(outside, "new.txt"), join(ws, "link"));
    await symlink(join(outside, "nested", "deeper.txt"), join(ws, "link2"));
    await expect(resolveRealInsideCwd(ws, "link")).rejects.toThrow(/outside/);
    await expect(resolveRealInsideCwd(ws, "link2")).rejects.toThrow(/outside/);
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
      await expect(map.get("terminal/create")?.({ command: "true" })).rejects.toThrow(/Auto-run is off/);
    } finally {
      cleanup();
    }
  });

  it("rejects malformed writes and terminals instead of guessing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-acp-bad-"));
    await writeFile(join(dir, "keep.txt"), "content");
    const map = new Map<string, (params: unknown) => Promise<unknown> | unknown>();
    const cleanup = registerHostHandlers({ handle: (m, fn) => void map.set(m, fn) }, dir, { autoRun: true });
    try {
      await expect(map.get("fs/write_text_file")?.({ path: "keep.txt" })).rejects.toThrow(/needs content/);
      expect(await readFile(join(dir, "keep.txt"), "utf8")).toBe("content");
      await expect(map.get("terminal/create")?.({ args: ["-c", "true"] })).rejects.toThrow(/needs a command/);
    } finally {
      cleanup();
    }
  });

  it("denies a call on protected paths even with auto-run on", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-acp-prot-"));
    const data = join(dir, "data");
    const map = new Map<string, (params: unknown) => Promise<unknown> | unknown>();
    const ledger = hostLedger();
    const cleanup = registerHostHandlers({ handle: (m, fn) => void map.set(m, fn) }, dir, { autoRun: true }, [data], ledger);
    try {
      const read = { toolCallId: "p1", kind: "read", locations: [{ path: join(data, "secrets.json") }] };
      await expect(map.get("session/request_permission")?.({ toolCall: read })).resolves.toMatchObject({
        outcome: { outcome: "cancelled" },
      });
      const shell = { toolCallId: "p2", kind: "execute", rawInput: { command: "cat data/secrets.json" } };
      await expect(map.get("session/request_permission")?.({ toolCall: shell })).resolves.toMatchObject({
        outcome: { outcome: "cancelled" },
      });
      const fine = { toolCallId: "p3", kind: "edit", locations: [{ path: join(dir, "src/a.ts") }] };
      await expect(map.get("session/request_permission")?.({ toolCall: fine })).resolves.toMatchObject({
        outcome: { outcome: "selected" },
      });
      expect([...ledger.denied].sort()).toEqual(["p1", "p2"]);
    } finally {
      cleanup();
    }
  });

  it("keeps multi-byte terminal output intact across chunks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-acp-utf8-"));
    const map = new Map<string, (params: unknown) => Promise<unknown> | unknown>();
    const cleanup = registerHostHandlers({ handle: (m, fn) => void map.set(m, fn) }, dir, { autoRun: true });
    try {
      /* "€" is three bytes; write them in two separate chunks. */
      const script = "const b=Buffer.from('€');process.stdout.write(b.subarray(0,1));setTimeout(()=>process.stdout.write(b.subarray(1)),50)";
      const { terminalId } = (await map.get("terminal/create")?.({ command: process.execPath, args: ["-e", script] })) as {
        terminalId: string;
      };
      await map.get("terminal/wait_for_exit")?.({ terminalId });
      await expect(map.get("terminal/output")?.({ terminalId })).resolves.toMatchObject({ output: "€" });
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
      await expect(map.get("session/request_permission")?.({ toolCall: { title: "Read config.ts" } })).resolves.toMatchObject({
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

  it("records the calls it refused and keeps a terminal's output after release", async () => {
    const map = new Map<string, (params: unknown) => Promise<unknown> | unknown>();
    const ledger = hostLedger();
    const off = registerHostHandlers({ handle: (m, fn) => void map.set(m, fn) }, cwd, { autoRun: false }, [], ledger);
    await map.get("session/request_permission")?.({ toolCall: { toolCallId: "x1", kind: "execute" } });
    await map.get("session/request_permission")?.({ toolCall: { toolCallId: "r1", kind: "read" } });
    off();
    expect([...ledger.denied]).toEqual(["x1"]);

    const runMap = new Map<string, (params: unknown) => Promise<unknown> | unknown>();
    const dir = await mkdtemp(join(tmpdir(), "glassys-acp-ledger-"));
    const cleanup = registerHostHandlers({ handle: (m, fn) => void runMap.set(m, fn) }, dir, { autoRun: true }, [], ledger);
    try {
      const { terminalId } = (await runMap.get("terminal/create")?.({ command: process.execPath, args: ["-e", "console.log('checking')"] })) as { terminalId: string };
      await runMap.get("terminal/wait_for_exit")?.({ terminalId });
      await runMap.get("terminal/release")?.({ terminalId });
      expect(ledger.output.get(terminalId)).toBe("checking\n");
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

  it("refuses a FIFO, an endless device and a file that is one endless line", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-acp-"));
    const map = new Map<string, (params: unknown) => Promise<unknown> | unknown>();
    const cleanup = registerHostHandlers({ handle: (m, fn) => void map.set(m, fn) }, dir, { autoRun: false });
    const devs = new Map<string, (params: unknown) => Promise<unknown> | unknown>();
    const cleanupDev = registerHostHandlers({ handle: (m, fn) => void devs.set(m, fn) }, "/dev", { autoRun: false });
    try {
      const read = map.get("fs/read_text_file")!;
      if (process.platform !== "win32") {
        execFileSync("mkfifo", [join(dir, "pipe")]);
        await expect(read({ path: "pipe" })).rejects.toThrow(/regular file/);
        await expect(read({ path: "pipe", line: 1, limit: 1 })).rejects.toThrow(/regular file/);
        await expect(devs.get("fs/read_text_file")!({ path: "zero" })).rejects.toThrow(/regular file/);
        await expect(devs.get("fs/read_text_file")!({ path: "zero", line: 1 })).rejects.toThrow(/regular file/);
      }
      await writeFile(join(dir, "one-line.log"), Buffer.alloc(MAX_ACP_READ_BYTES * 2, 0x61));
      await expect(read({ path: "one-line.log", line: 1, limit: 1 })).rejects.toThrow(/longer than/);
      await writeFile(join(dir, "ok.log"), "a\nb\nc\n");
      await expect(read({ path: "ok.log", line: 2, limit: 1 })).resolves.toEqual({ content: "b" });
      await expect(read({ path: "ok.log" })).resolves.toEqual({ content: "a\nb\nc\n" });
    } finally {
      cleanup();
      cleanupDev();
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
      await expect(map.get("terminal/create")?.({ command: "cat", args: [join(data, "secrets.json")] })).rejects.toThrow(/denied/);
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
      const created = (await map.get("terminal/create")?.({
        command: process.execPath,
        args: ["-e", "process.exit(7)"],
      })) as { terminalId: string };
      await new Promise((r) => setTimeout(r, 80));
      const result = await map.get("terminal/wait_for_exit")?.({ terminalId: created.terminalId });
      expect(result).toEqual({ exitCode: 7, signal: null });
    } finally {
      cleanup();
    }
  });

  it("reports a missing binary instead of crashing the process", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-acp-term-"));
    const map = new Map<string, (params: unknown) => Promise<unknown> | unknown>();
    const cleanup = registerHostHandlers({ handle: (m, fn) => void map.set(m, fn) }, dir, { autoRun: true });
    try {
      const created = (await map.get("terminal/create")?.({ command: "glassys-no-such-binary-xyz" })) as { terminalId: string };
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
    const a = (await map.get("terminal/create")?.({ command: process.execPath, args })) as { terminalId: string };
    const b = (await map.get("terminal/create")?.({ command: process.execPath, args })) as { terminalId: string };
    expect(a.terminalId).not.toBe(b.terminalId);
    const waiting = map.get("terminal/wait_for_exit")?.({ terminalId: a.terminalId });
    cleanup();
    await expect(waiting).resolves.toMatchObject({ signal: "SIGTERM" });
  });

  it("keeps a killed terminal readable and reports how it ended", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-acp-term-"));
    const map = new Map<string, (params: unknown) => Promise<unknown> | unknown>();
    const cleanup = registerHostHandlers({ handle: (m, fn) => void map.set(m, fn) }, dir, { autoRun: true });
    try {
      const t = (await map.get("terminal/create")?.({
        command: process.execPath,
        args: ["-e", "console.log('started'); setInterval(() => {}, 1000)"],
      })) as { terminalId: string };
      await new Promise((r) => setTimeout(r, 200));
      await map.get("terminal/kill")?.({ terminalId: t.terminalId });
      const exit = (await map.get("terminal/wait_for_exit")?.({ terminalId: t.terminalId })) as {
        exitCode: number | null;
        signal: string | null;
      };
      expect(exit.exitCode === 0 && exit.signal === null).toBe(false);
      const out = (await map.get("terminal/output")?.({ terminalId: t.terminalId })) as {
        output: string;
        exitStatus?: unknown;
      };
      expect(out.output).toMatch(/started/);
      expect(out.exitStatus).toEqual(exit);
      await map.get("terminal/release")?.({ terminalId: t.terminalId });
      await expect(map.get("terminal/wait_for_exit")?.({ terminalId: t.terminalId })).rejects.toThrow(/Unknown terminal/);
    } finally {
      cleanup();
    }
  });

  it("runs in the requested cwd with the requested env and byte limit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-acp-term-"));
    await mkdir(join(dir, "sub"));
    const map = new Map<string, (params: unknown) => Promise<unknown> | unknown>();
    const cleanup = registerHostHandlers({ handle: (m, fn) => void map.set(m, fn) }, dir, { autoRun: true });
    try {
      const t = (await map.get("terminal/create")?.({
        command: process.execPath,
        args: ["-e", "process.stdout.write(process.cwd() + ' ' + process.env.GLASSYS_T + ' ' + 'x'.repeat(200))"],
        cwd: join(dir, "sub"),
        env: [{ name: "GLASSYS_T", value: "on" }],
        outputByteLimit: 64,
      })) as { terminalId: string };
      await map.get("terminal/wait_for_exit")?.({ terminalId: t.terminalId });
      const out = (await map.get("terminal/output")?.({ terminalId: t.terminalId })) as { output: string; truncated: boolean };
      expect(out.truncated).toBe(true);
      expect(Buffer.byteLength(out.output)).toBeLessThanOrEqual(64);
      await expect(map.get("terminal/create")?.({ command: "true", cwd: "/" })).rejects.toThrow(/outside/);
      const full = (await map.get("terminal/create")?.({
        command: process.execPath,
        args: ["-e", "process.stdout.write(require('path').basename(process.cwd()) + ' ' + process.env.GLASSYS_T)"],
        cwd: "sub",
        env: [{ name: "GLASSYS_T", value: "on" }],
      })) as { terminalId: string };
      await map.get("terminal/wait_for_exit")?.({ terminalId: full.terminalId });
      const shown = (await map.get("terminal/output")?.({ terminalId: full.terminalId })) as { output: string };
      expect(shown.output).toBe("sub on");
    } finally {
      cleanup();
    }
  });

  it("reads a line range of a file too large to read whole", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-acp-"));
    const map = new Map<string, (params: unknown) => Promise<unknown> | unknown>();
    const cleanup = registerHostHandlers({ handle: (m, fn) => void map.set(m, fn) }, dir, { autoRun: true });
    try {
      const lines = Array.from({ length: 200_000 }, (_, i) => `line ${i + 1} ${"x".repeat(10)}`);
      await writeFile(join(dir, "big.log"), lines.join("\n"));
      await expect(map.get("fs/read_text_file")?.({ path: "big.log", line: 3, limit: 2 })).resolves.toEqual({
        content: `${lines[2]}\n${lines[3]}`,
      });
    } finally {
      cleanup();
    }
  });
});

describe("acpPermissionChoice", () => {
  const options = [
    { optionId: "proceed_always", kind: "allow_always", name: "Always" },
    { optionId: "proceed_once", kind: "allow_once", name: "Once" },
    { optionId: "cancel", kind: "reject_once", name: "No" },
  ];

  it("picks the agent's own ids by kind", () => {
    expect(acpPermissionChoice({ options }, true)).toEqual({ outcome: { outcome: "selected", optionId: "proceed_once" } });
    expect(acpPermissionChoice({ options }, false)).toEqual({ outcome: { outcome: "selected", optionId: "cancel" } });
  });

  it("falls back for agents that send no options", () => {
    expect(acpPermissionChoice({}, true)).toEqual({ outcome: { outcome: "selected", optionId: "allow-once" } });
    expect(acpPermissionChoice({}, false)).toEqual({ outcome: { outcome: "cancelled" } });
  });
});
