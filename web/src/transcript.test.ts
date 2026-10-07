import { describe, expect, it } from "vitest";
import { MAX_TOOL_CHUNK, reduceTranscript, replay } from "./transcript";

describe("transcript reducer", () => {
  it("keeps a running turn's output above a message queued during it", () => {
    const blocks = replay([
      { type: "user.message", text: "long", id: "m1" },
      { type: "run.start", runId: "r1", messageId: "m1" },
      { type: "text.delta", text: "tick 1 " },
      { type: "user.message", text: "follow-up", id: "m2" },
      { type: "text.delta", text: "tick 2" },
      { type: "tool.start", callId: "t1", kind: "shell", title: "ls" },
      { type: "run.usage", inputTokens: 3 },
      { type: "run.done" },
      { type: "run.start", runId: "r2", messageId: "m2" },
      { type: "text.delta", text: "answer 2" },
      { type: "run.done" },
    ]);
    expect(blocks.map((b) => (b.kind === "user" || b.kind === "text" ? `${b.kind}:${b.text}` : b.kind))).toEqual([
      "user:long",
      "text:tick 1 tick 2",
      "tool",
      "usage",
      "user:follow-up",
      "text:answer 2",
    ]);
  });

  it("appends as before when run.start names no message, or a run failed before starting", () => {
    const old = replay([
      { type: "user.message", text: "a", id: "m1" },
      { type: "text.delta", text: "x" },
      { type: "user.message", text: "b", id: "m2" },
      { type: "text.delta", text: "y" },
    ]);
    expect(old.map((b) => b.kind)).toEqual(["user", "text", "user", "text"]);
    const failed = replay([
      { type: "user.message", text: "a", id: "m1" },
      { type: "run.start", messageId: "m1" },
      { type: "run.done" },
      { type: "user.message", text: "b", id: "m2" },
      { type: "run.error", message: "Attachments could not be read", phase: "startup" },
    ]);
    expect(failed.map((b) => b.kind)).toEqual(["user", "user", "banner"]);
  });

  it("starts a new card when a finished call id comes back in a later turn", () => {
    const turn = (text: string) => [
      { type: "user.message" as const, text },
      { type: "tool.start" as const, callId: "item_0", kind: "shell" as const, title: "ls", command: text },
      { type: "tool.end" as const, callId: "item_0", ok: true, kind: "shell" as const, outputPreview: text },
      { type: "run.done" as const },
    ];
    const blocks = replay([...turn("first"), ...turn("second")]);
    const tools = blocks.filter((b) => b.kind === "tool");
    expect(tools.map((b) => (b.kind === "tool" ? [b.command, b.outputPreview, b.status] : []))).toEqual([
      ["first", "first", "done"],
      ["second", "second", "done"],
    ]);
    expect(new Set(tools.map((b) => b.id)).size).toBe(2);
  });

  it("still refines a running call from a second start", () => {
    const blocks = replay([
      { type: "tool.start", callId: "t1", kind: "edit", title: "Edit" },
      { type: "tool.start", callId: "t1", kind: "edit", title: "Edit a.ts", path: "/w/a.ts" },
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ title: "Edit a.ts", path: "/w/a.ts", status: "running" });
  });

  it("keeps only the tail of a long tool stream, cut on a line", () => {
    let blocks = reduceTranscript([], { type: "tool.start", callId: "c1", kind: "shell", title: "Shell" });
    const line = `${"x".repeat(99)}\n`;
    for (let i = 0; i < 1000; i++) {
      blocks = reduceTranscript(blocks, { type: "tool.progress", callId: "c1", chunk: line });
    }
    blocks = reduceTranscript(blocks, { type: "tool.progress", callId: "c1", chunk: "last line" });
    const tool = blocks[0];
    if (tool?.kind !== "tool") throw new Error("expected a tool block");
    expect(tool.chunk.length).toBeLessThanOrEqual(MAX_TOOL_CHUNK);
    expect(tool.chunk.startsWith("x")).toBe(true);
    expect(tool.chunk.endsWith("last line")).toBe(true);
  });

  it("uses stable tool keys from callId", () => {
    const start = reduceTranscript([], {
      type: "tool.start",
      callId: "c1",
      kind: "read",
      title: "Read",
    });
    expect(start[0]?.id).toBe("tool:c1");
    const replayed = replay([
      { type: "tool.start", callId: "c1", kind: "read", title: "Read" },
      { type: "tool.start", callId: "c1", kind: "read", title: "Read", path: "a.ts" },
      { type: "tool.end", callId: "c1", ok: true, kind: "read" },
    ]);
    expect(replayed).toHaveLength(1);
    expect(replayed[0]).toMatchObject({ kind: "tool", path: "a.ts" });
  });

  it("does not keep queued banners in the thread", () => {
    const live = reduceTranscript([], { type: "run.queued" });
    expect(live.some((b) => b.kind === "banner")).toBe(false);
    const afterStart = reduceTranscript(live, { type: "run.start" });
    expect(afterStart.some((b) => b.kind === "banner")).toBe(false);
    const snap = replay([{ type: "user.message", text: "hi" }, { type: "text.delta", text: "yo" }]);
    expect(snap.map((b) => b.kind)).toEqual(["user", "text"]);
  });

  it("marks tools cut off by a cancel or an error as stopped, not done", () => {
    const start = reduceTranscript([], {
      type: "tool.start",
      callId: "c1",
      kind: "read",
      title: "Read",
    });
    const cancelled = reduceTranscript(start, { type: "run.cancelled" });
    expect(cancelled.find((b) => b.kind === "tool")).toMatchObject({ status: "stopped" });
    const failed = reduceTranscript(start, { type: "run.error", message: "boom", phase: "run" });
    expect(failed.find((b) => b.kind === "tool")).toMatchObject({ status: "stopped" });
    const finished = reduceTranscript(start, { type: "run.done" });
    expect(finished.find((b) => b.kind === "tool")).toMatchObject({ status: "done" });
  });

  it("marks retracted user messages, denied tools, and usage", () => {
    const withUser = reduceTranscript([], {
      type: "user.message",
      id: "m1",
      text: "pic",
      attachments: [{ id: "u1", mime: "image/png", name: "a.png" }],
    });
    expect(withUser[0]).toMatchObject({ kind: "user", messageId: "m1", attachments: [{ id: "u1" }] });
    const retracted = reduceTranscript(withUser, { type: "user.retracted", id: "m1" });
    expect(retracted[0]).toMatchObject({ kind: "user", retracted: true });
    const denied = reduceTranscript([], {
      type: "tool.end",
      callId: "c2",
      ok: false,
      denied: true,
      kind: "write",
    });
    expect(denied[0]).toMatchObject({ kind: "tool", status: "denied" });
    const usage = reduceTranscript([], { type: "run.usage", inputTokens: 3, outputTokens: 9 });
    expect(usage[0]).toMatchObject({ kind: "usage", inputTokens: 3, outputTokens: 9 });
    const stalled = reduceTranscript([], { type: "run.stalled", idleMs: 180000 });
    expect(stalled[0]).toMatchObject({ kind: "banner", code: "stalled" });
  });

  it("clears the stall warning once the agent speaks again or the run ends", () => {
    const stalled = reduceTranscript([], { type: "run.stalled", idleMs: 180000 });
    expect(reduceTranscript(stalled, { type: "run.stalled", idleMs: 360000 }).filter((b) => b.kind === "banner")).toHaveLength(1);
    const resumed = reduceTranscript(stalled, { type: "text.delta", text: "back" });
    expect(resumed.map((b) => b.kind)).toEqual(["text"]);
    const ended = reduceTranscript(reduceTranscript([], { type: "text.delta", text: "x" }), { type: "run.stalled", idleMs: 1 });
    expect(reduceTranscript(ended, { type: "run.done" }).some((b) => b.kind === "banner")).toBe(false);
  });

  it("applies a batch like the same events one by one", async () => {
    const { reduceTranscriptBatch } = await import("./transcript");
    const events = [
      { type: "user.message", text: "hi", id: "u" },
      { type: "text.delta", text: "a" },
      { type: "text.delta", text: "b" },
      { type: "tool.start", callId: "c", kind: "shell", title: "ls" },
      { type: "tool.end", callId: "c", ok: true, kind: "shell" },
      { type: "run.done" },
    ] as const;
    const one = events.reduce((acc, e) => reduceTranscript(acc, e), [] as ReturnType<typeof reduceTranscript>);
    const batched = reduceTranscriptBatch([], [...events]);
    expect(batched.map(({ id: _id, ...rest }) => rest)).toEqual(one.map(({ id: _id, ...rest }) => rest));
  });

  it("closes open thinking on run.done without inventing a duration", () => {
    const open = reduceTranscript([], { type: "thinking.delta", text: "plan" });
    expect(open[0]).toMatchObject({ kind: "thinking", text: "plan" });
    expect(open[0] && "durationMs" in open[0] ? open[0].durationMs : undefined).toBeUndefined();
    const closed = reduceTranscript(open, { type: "run.done" });
    expect(closed[0]).toMatchObject({ kind: "thinking", durationMs: 0 });
  });

  it("paints text.delta immediately and run.error as a banner", () => {
    const first = reduceTranscript([], { type: "text.delta", text: "Hel" });
    const next = reduceTranscript(first, { type: "text.delta", text: "lo" });
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ kind: "text", text: "Hello" });
    const err = reduceTranscript(next, { type: "run.error", message: "boom", phase: "run" });
    expect(err.some((b) => b.kind === "banner" && b.tone === "error" && "text" in b && b.text === "boom")).toBe(true);
  });

  it("changes keys across replay generations", () => {
    const first = replay([{ type: "user.message", text: "a" }]);
    const second = replay([{ type: "user.message", text: "a" }]);
    expect(first[0]?.id).not.toBe(second[0]?.id);
  });
});
