import { open, readFile } from "node:fs/promises";
import type { TranscriptEvent } from "@glassys/protocol";
import { appendLiveTranscriptLine, ensureLiveThread, liveTranscriptPath, refreshLiveTitle } from "./threads.js";
import { parseJsonl } from "./jsonl.js";

export const TRANSCRIPT_SNAPSHOT_MAX_BYTES = 2 * 1024 * 1024;
export const TRANSCRIPT_SNAPSHOT_MAX_EVENTS = 800;

async function filePath(): Promise<string> {
  await ensureLiveThread();
  return liveTranscriptPath();
}

export async function appendTranscript(event: TranscriptEvent): Promise<void> {
  await appendLiveTranscriptLine(`${JSON.stringify(event)}\n`);
  if (event.type === "user.message") await refreshLiveTitle();
}

export async function readTranscript(): Promise<TranscriptEvent[]> {
  try {
    return parseJsonl<TranscriptEvent>(await readFile(await filePath(), "utf8"));
  } catch {
    return [];
  }
}

function snapshotFromTail(tail: string, cut: boolean): { events: TranscriptEvent[]; truncated: boolean } {
  let body = tail;
  if (cut) {
    const nl = tail.indexOf("\n");
    body = nl >= 0 ? tail.slice(nl + 1) : tail;
  }
  const events = parseJsonl<TranscriptEvent>(body);
  if (events.length <= TRANSCRIPT_SNAPSHOT_MAX_EVENTS) return { events, truncated: cut };
  return { events: events.slice(-TRANSCRIPT_SNAPSHOT_MAX_EVENTS), truncated: true };
}

export function snapshotFromRaw(raw: string): { events: TranscriptEvent[]; truncated: boolean } {
  if (raw.length <= TRANSCRIPT_SNAPSHOT_MAX_BYTES) return snapshotFromTail(raw, false);
  return snapshotFromTail(raw.slice(-TRANSCRIPT_SNAPSHOT_MAX_BYTES), true);
}

/* A long-lived thread grows to tens of megabytes; every reconnect only needs the
   last few, so read them from the end instead of loading the whole file. The
   cut lands mid-line (maybe mid-character) and that first line is dropped. */
export async function readTranscriptTail(
  path: string,
  maxBytes = TRANSCRIPT_SNAPSHOT_MAX_BYTES,
): Promise<{ events: TranscriptEvent[]; truncated: boolean }> {
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

export async function readTranscriptSnapshot(): Promise<{ events: TranscriptEvent[]; truncated: boolean }> {
  try {
    return await readTranscriptTail(await filePath());
  } catch {
    return { events: [], truncated: false };
  }
}
