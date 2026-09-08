import { describe, expect, it } from "vitest";
import { reduceTranscript, replay } from "./transcript";

describe("transcript reducer", () => {
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
    expect(snap.some((b) => b.kind === "banner" && b.tone === "queue")).toBe(false);
    expect(snap.map((b) => b.kind)).toEqual(["user", "text"]);
  });

  it("closes running tools when the run is cancelled", () => {
    const start = reduceTranscript([], {
      type: "tool.start",
      callId: "c1",
      kind: "read",
      title: "Read",
    });
    const closed = reduceTranscript(start, { type: "run.cancelled" });
    expect(closed.find((b) => b.kind === "tool")).toMatchObject({ status: "done" });
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
