import { describe, expect, it } from "vitest";
import { snapshotFromRaw, TRANSCRIPT_SNAPSHOT_MAX_EVENTS } from "./transcript.js";

describe("transcript snapshot", () => {
  it("returns the full file when it is small", () => {
    const raw = `${JSON.stringify({ type: "user.message", text: "hi", id: "a" })}\n`;
    expect(snapshotFromRaw(raw)).toEqual({
      events: [{ type: "user.message", text: "hi", id: "a" }],
      truncated: false,
    });
  });

  it("keeps the tail when the event count exceeds the snapshot cap", () => {
    const lines = Array.from({ length: TRANSCRIPT_SNAPSHOT_MAX_EVENTS + 3 }, (_, i) =>
      JSON.stringify({ type: "user.message", text: `m${i}`, id: `id${i}` }),
    );
    const snap = snapshotFromRaw(`${lines.join("\n")}\n`);
    expect(snap.truncated).toBe(true);
    expect(snap.events).toHaveLength(TRANSCRIPT_SNAPSHOT_MAX_EVENTS);
    expect(snap.events[0]).toMatchObject({ text: "m3" });
    expect(snap.events.at(-1)).toMatchObject({ text: `m${TRANSCRIPT_SNAPSHOT_MAX_EVENTS + 2}` });
  });
});
