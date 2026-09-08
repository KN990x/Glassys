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
      { type: "tool.end", callId: "c1", ok: true, kind: "read" },
    ]);
    expect(replayed[0]?.id).toBe("tool:c1");
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

  it("paints cancelled as an info banner", () => {
    const next = reduceTranscript([], { type: "run.cancelled" });
    expect(next[0]).toMatchObject({ kind: "banner", text: "cancelled", tone: "info" });
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
