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
      lastSeq: 0,
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

  it("names the last seq it read, even past the event cap", () => {
    const lines = Array.from({ length: TRANSCRIPT_SNAPSHOT_MAX_EVENTS + 2 }, (_, i) =>
      JSON.stringify({ type: "user.message", text: `m${i}`, seq: i + 1 }),
    );
    expect(snapshotFromRaw(`${lines.join("\n")}\n`).lastSeq).toBe(TRANSCRIPT_SNAPSHOT_MAX_EVENTS + 2);
  });
});

describe("live transcript batching", () => {
  it("merges a burst of deltas into one line, numbers every event, and flushes before a read", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-batch-"));
    process.env.GLASSYS_DATA_DIR = dir;
    const { resetLiveThreadCache, liveTranscriptPath } = await import("./threads.js");
    resetLiveThreadCache();
    const { appendTranscript, readTranscriptSnapshot } = await import("./transcript.js");
    const { readFile } = await import("node:fs/promises");
    try {
      const user = await appendTranscript({ type: "user.message", text: "hi", id: "u1" });
      const a = await appendTranscript({ type: "text.delta", text: "Hel" });
      const b = await appendTranscript({ type: "text.delta", text: "lo" });
      const done = await appendTranscript({ type: "run.done" });
      expect([user.seq, a.seq, b.seq, done.seq]).toEqual([1, 2, 3, 4]);
      const lines = (await readFile(liveTranscriptPath(), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
      expect(lines).toEqual([
        { type: "user.message", text: "hi", id: "u1", seq: 1 },
        { type: "text.delta", text: "Hello", seq: 3 },
        { type: "run.done", seq: 4 },
      ]);
      /* A pending delta is in the snapshot, and seq continues after a restart reads the file. */
      await appendTranscript({ type: "text.delta", text: "!" });
      const snap = await readTranscriptSnapshot();
      expect(snap.lastSeq).toBe(5);
      resetLiveThreadCache();
      const next = await appendTranscript({ type: "run.done" });
      expect(next.seq).toBe(6);
    } finally {
      resetLiveThreadCache();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
