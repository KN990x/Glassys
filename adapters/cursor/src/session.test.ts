import { describe, expect, it, vi } from "vitest";

/* A scripted local Cursor agent: each send returns the next run. */
type FakeRun = {
  id: string;
  supports: (what: string) => boolean;
  cancel: () => Promise<void>;
  wait: () => Promise<unknown>;
};
const runs: FakeRun[] = [];
const cancels: string[] = [];

function fakeRun(id: string, result: unknown, opts: { cancellable?: boolean } = {}): FakeRun {
  return {
    id,
    supports: (what) => what !== "cancel" || opts.cancellable !== false,
    cancel: async () => {
      cancels.push(id);
    },
    wait: async () => result,
  };
}

vi.mock("@cursor/sdk", () => {
  class CursorSdkError extends Error {}
  const agent = {
    agentId: "agent-1",
    send: async () => runs.shift(),
    [Symbol.asyncDispose]: async () => undefined,
  };
  return {
    Agent: { create: async () => agent, resume: async () => agent },
    Cursor: { models: { list: async () => [] }, auth: { status: async () => ({}) } },
    JsonlLocalAgentStore: class {},
    CursorSdkError,
  };
});

const { cursorAdapter } = await import("./index.js");
const opts = { cwd: "/tmp/ws", model: "grok-4.6", modelParams: [], storeDir: "/tmp/store", options: {} };

describe("cursor session", () => {
  it("reports usage, and turns a failed result into one run.error", async () => {
    runs.push(fakeRun("r1", { status: "error", message: "model overloaded", usage: { inputTokens: 12, outputTokens: 3 } }));
    const session = await cursorAdapter.create(opts);
    const events: Array<{ type: string; message?: string }> = [];
    const run = await session.send("hi", (e) => events.push(e as { type: string }));
    expect(await run.wait()).toBe("error");
    expect(events).toEqual([
      { type: "run.usage", inputTokens: 12, outputTokens: 3 },
      { type: "run.error", message: "model overloaded", phase: "run" },
    ]);
  });

  it("finishes, and passes a cancel on only while the run is going", async () => {
    runs.push(fakeRun("r2", { status: "finished" }));
    const session = await cursorAdapter.create(opts);
    const run = await session.send("hi", () => undefined);
    await run.cancel();
    expect(cancels).toContain("r2");
    expect(await run.wait()).toBe("finished");
    cancels.length = 0;
    /* Over: a late cancel must not reach the SDK, where it could hit the next run. */
    await run.cancel();
    expect(cancels).toEqual([]);
  });

  it("refuses a cancel the run does not support", async () => {
    runs.push(fakeRun("r3", { status: "finished" }, { cancellable: false }));
    const session = await cursorAdapter.create(opts);
    const run = await session.send("hi", () => undefined);
    await expect(run.cancel()).rejects.toThrow(/cannot be cancelled/);
  });
});
