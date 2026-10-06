import { describe, expect, it, vi } from "vitest";

const calls: Array<{ kind: "start" | "resume"; id?: string; model?: string }> = [];
const sandboxes: Array<string | undefined> = [];

vi.mock("@openai/codex-sdk", () => {
  class FakeThread {
    constructor(public id: string | null) {}
    async runStreamed() {
      return { events: (async function* () {})() };
    }
  }
  class Codex {
    startThread(opts: { model?: string; sandboxMode?: string }) {
      calls.push({ kind: "start", model: opts.model });
      sandboxes.push(opts.sandboxMode);
      return new FakeThread(null);
    }
    resumeThread(id: string, opts: { model?: string; sandboxMode?: string }) {
      calls.push({ kind: "resume", id, model: opts.model });
      sandboxes.push(opts.sandboxMode);
      return new FakeThread(id);
    }
  }
  return { Codex };
});

const { codexAdapter } = await import("./index.js");

const opts = { cwd: "/tmp", model: "gpt-5.6-sol", modelParams: [], storeDir: "/tmp/s", options: {} };

describe("codex model switch", () => {
  it("reopens the thread on the new model at the next send", async () => {
    calls.length = 0;
    const session = await codexAdapter.resume("thread-1", opts);
    const run = await session.send("hi", () => undefined, { model: "gpt-5.6-luna" });
    await run.wait();
    expect(calls).toEqual([
      { kind: "resume", id: "thread-1", model: "gpt-5.6-sol" },
      { kind: "resume", id: "thread-1", model: "gpt-5.6-luna" },
    ]);
    expect((session as unknown as { model: string }).model).toBe("gpt-5.6-luna");
  });

  it("keeps the thread when the model does not change", async () => {
    calls.length = 0;
    const session = await codexAdapter.resume("thread-1", opts);
    await (await session.send("hi", () => undefined, { model: "gpt-5.6-sol" })).wait();
    expect(calls).toHaveLength(1);
  });

  it("starts a thread on the new model before the first turn", async () => {
    calls.length = 0;
    const session = await codexAdapter.create(opts);
    await (await session.send("hi", () => undefined, { model: "gpt-5.6-terra" })).wait();
    expect(calls).toEqual([
      { kind: "start", model: "gpt-5.6-sol" },
      { kind: "start", model: "gpt-5.6-terra" },
    ]);
  });
});

describe("codex sandbox mode", () => {
  it("passes the operator's pick and leaves Codex's config alone otherwise", async () => {
    sandboxes.length = 0;
    await codexAdapter.create({ ...opts, options: { sandboxMode: "workspace-write" } });
    await codexAdapter.create({ ...opts, options: {} });
    await codexAdapter.create({ ...opts, options: { sandboxMode: "yolo" } });
    expect(sandboxes).toEqual(["workspace-write", undefined, undefined]);
  });

  it("drops an unknown mode from the saved config", () => {
    const agent = { adapter: "codex", cwd: "/tmp", model: "", modelParams: [], options: { sandboxMode: "yolo" } };
    expect(codexAdapter.normalizeConfig!(agent).options).toEqual({});
  });
});
