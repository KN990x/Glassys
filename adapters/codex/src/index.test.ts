import { describe, expect, it, vi } from "vitest";

const calls: Array<{ kind: "start" | "resume"; id?: string; model?: string }> = [];
const sandboxes: Array<string | undefined> = [];
const efforts: Array<string | undefined> = [];
/* Scripted turns: each runStreamed consumes the next list of events. */
const scripted: unknown[][] = [];
const inputs: unknown[] = [];

vi.mock("@openai/codex-sdk", () => {
  class FakeThread {
    constructor(public id: string | null) {}
    async runStreamed(input: unknown) {
      inputs.push(input);
      const events = scripted.shift() ?? [];
      return {
        events: (async function* () {
          for (const e of events) yield e;
        })(),
      };
    }
  }
  class Codex {
    startThread(opts: { model?: string; sandboxMode?: string; modelReasoningEffort?: string }) {
      calls.push({ kind: "start", model: opts.model });
      sandboxes.push(opts.sandboxMode);
      efforts.push(opts.modelReasoningEffort);
      return new FakeThread(null);
    }
    resumeThread(id: string, opts: { model?: string; sandboxMode?: string; modelReasoningEffort?: string }) {
      calls.push({ kind: "resume", id, model: opts.model });
      sandboxes.push(opts.sandboxMode);
      efforts.push(opts.modelReasoningEffort);
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

describe("codex effort, images and lost threads", () => {
  it("opens the thread with the operator's effort and reopens it when effort changes", async () => {
    efforts.length = 0;
    const session = await codexAdapter.create({ ...opts, modelParams: [{ id: "effort", value: "high" }] });
    await (await session.send("hi", () => undefined, { model: "gpt-5.6-sol", modelParams: [{ id: "effort", value: "low" }] } as never)).wait();
    expect(efforts).toEqual(["high", "low"]);
  });

  it("sends image attachments as local_image input", async () => {
    inputs.length = 0;
    const session = await codexAdapter.create(opts);
    const attachments = [{ path: "/w/.glassys-uploads/1-a.png", mime: "image/png", name: "a.png" }];
    await (await session.send("look", () => undefined, { attachments })).wait();
    expect(inputs.at(-1)).toEqual([
      expect.objectContaining({ type: "text" }),
      { type: "local_image", path: "/w/.glassys-uploads/1-a.png" },
    ]);
  });

  it("starts a new thread and resends when the stored one is gone", async () => {
    calls.length = 0;
    scripted.push(
      [{ type: "turn.failed", error: { message: "no rollout found for thread id old" } }],
      [{ type: "thread.started", thread_id: "new" }, { type: "item.completed", item: { id: "a", type: "agent_message", text: "fresh" } }, { type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } }],
    );
    const session = await codexAdapter.resume("old", opts);
    const events: Array<{ type: string }> = [];
    const run = await session.send("hi", (e) => events.push(e));
    expect(await run.wait()).toBe("finished");
    expect(calls.map((c) => c.kind)).toEqual(["resume", "start"]);
    expect(events.filter((e) => e.type === "run.error")).toEqual([]);
    expect(session.agentId).toBe("new");
  });
});
