import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readTranscriptTail, snapshotFromRaw, TRANSCRIPT_SNAPSHOT_MAX_EVENTS } from "./transcript.js";

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

  it("reads only the tail of a large file and drops the line it cut through", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-tail-"));
    try {
      const file = join(dir, "transcript.jsonl");
      const lines = Array.from({ length: 50 }, (_, i) =>
        JSON.stringify({ type: "user.message", text: `ñ-${i}-${"x".repeat(40)}`, id: `id${i}` }),
      );
      await writeFile(file, `${lines.join("\n")}\n`);
      const snap = await readTranscriptTail(file, 500);
      expect(snap.truncated).toBe(true);
      expect(snap.events.length).toBeGreaterThan(0);
      expect(snap.events.length).toBeLessThan(50);
      expect(snap.events.at(-1)).toMatchObject({ id: "id49" });
      const ids = snap.events.map((e) => (e as { id: string }).id);
      expect(ids).toEqual(ids.slice().sort((a, b) => Number(a.slice(2)) - Number(b.slice(2))));

      const whole = await readTranscriptTail(file);
      expect(whole).toMatchObject({ truncated: false });
      expect(whole.events).toHaveLength(50);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
