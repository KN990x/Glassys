import { open, readFile } from "node:fs/promises";
import type { TranscriptEvent } from "@glassys/protocol";
import { ensureLiveThread, flushLiveTranscript, liveTranscriptPath, refreshLiveTitle, stageLiveEvent } from "./threads.js";
import { parseJsonl } from "./jsonl.js";

export const TRANSCRIPT_SNAPSHOT_MAX_BYTES = 2 * 1024 * 1024;
export const TRANSCRIPT_SNAPSHOT_MAX_EVENTS = 800;

async function filePath(): Promise<string> {
  await ensureLiveThread();
  return liveTranscriptPath();
}

/**
 * Queue an event for the live transcript and return it stamped with its seq. Streamed deltas are
 * batched; anything else is on disk before this returns.
 */
export async function appendTranscript(event: TranscriptEvent): Promise<TranscriptEvent> {
  const { event: stamped, flushNow } = await stageLiveEvent(event);
  if (flushNow) await flushLiveTranscript();
  if (event.type === "user.message") await refreshLiveTitle(event.text);
  return stamped;
}

export async function readTranscript(): Promise<TranscriptEvent[]> {
  try {
    await flushLiveTranscript();
    return parseJsonl<TranscriptEvent>(await readFile(await filePath(), "utf8"));
  } catch {
    return [];
  }
}

export type TranscriptSnapshot = { events: TranscriptEvent[]; truncated: boolean; lastSeq: number };

function lastSeqOf(events: TranscriptEvent[]): number {
  for (let i = events.length - 1; i >= 0; i--) {
    const seq = events[i]!.seq;
    if (typeof seq === "number") return seq;
  }
  return 0;
}

function snapshotFromTail(tail: string, cut: boolean): TranscriptSnapshot {
  let body = tail;
  if (cut) {
    const nl = tail.indexOf("\n");
    body = nl >= 0 ? tail.slice(nl + 1) : tail;
  }
  const all = parseJsonl<TranscriptEvent>(body);
  /* lastSeq covers every line read, even ones the event cap leaves out. */
  const lastSeq = lastSeqOf(all);
  if (all.length <= TRANSCRIPT_SNAPSHOT_MAX_EVENTS) return { events: all, truncated: cut, lastSeq };
  return { events: all.slice(-TRANSCRIPT_SNAPSHOT_MAX_EVENTS), truncated: true, lastSeq };
}

export function snapshotFromRaw(raw: string): TranscriptSnapshot {
  if (raw.length <= TRANSCRIPT_SNAPSHOT_MAX_BYTES) return snapshotFromTail(raw, false);
  return snapshotFromTail(raw.slice(-TRANSCRIPT_SNAPSHOT_MAX_BYTES), true);
}

/* A long-lived thread grows to tens of megabytes; every reconnect only needs the
   last few, so read them from the end instead of loading the whole file. The
   cut lands mid-line (maybe mid-character) and that first line is dropped. */
export async function readTranscriptTail(path: string, maxBytes = TRANSCRIPT_SNAPSHOT_MAX_BYTES): Promise<TranscriptSnapshot> {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, maxBytes);
    const buf = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const { bytesRead } = await handle.read(buf, read, length - read, size - length + read);
      if (bytesRead === 0) break;
      read += bytesRead;
    }
    return snapshotFromTail(buf.subarray(0, read).toString("utf8"), size > maxBytes);
  } finally {
    await handle.close();
  }
}

/** The live thread's latest events, everything staged included. */
export async function readTranscriptSnapshot(): Promise<TranscriptSnapshot> {
  try {
    await flushLiveTranscript();
    return await readTranscriptTail(await filePath());
  } catch {
    return { events: [], truncated: false, lastSeq: 0 };
  }
}
