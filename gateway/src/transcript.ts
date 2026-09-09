import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { TranscriptEvent } from "@glassys/protocol";
import { ensureLiveThread, liveTranscriptPath, refreshLiveTitle } from "./threads.js";
import { parseJsonl } from "./jsonl.js";

export const TRANSCRIPT_SNAPSHOT_MAX_BYTES = 2 * 1024 * 1024;
export const TRANSCRIPT_SNAPSHOT_MAX_EVENTS = 800;

async function filePath(): Promise<string> {
  await ensureLiveThread();
  return liveTranscriptPath();
}

export async function appendTranscript(event: TranscriptEvent): Promise<void> {
  const path = await filePath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(event)}\n`, { encoding: "utf8", flag: "a" });
  if (event.type === "user.message") await refreshLiveTitle();
}

export async function readTranscript(): Promise<TranscriptEvent[]> {
  try {
    return parseJsonl<TranscriptEvent>(await readFile(await filePath(), "utf8"));
  } catch {
    return [];
  }
}

export function snapshotFromRaw(raw: string): { events: TranscriptEvent[]; truncated: boolean } {
  if (raw.length <= TRANSCRIPT_SNAPSHOT_MAX_BYTES) {
    const events = parseJsonl<TranscriptEvent>(raw);
    if (events.length <= TRANSCRIPT_SNAPSHOT_MAX_EVENTS) return { events, truncated: false };
    return { events: events.slice(-TRANSCRIPT_SNAPSHOT_MAX_EVENTS), truncated: true };
  }
  const tail = raw.slice(-TRANSCRIPT_SNAPSHOT_MAX_BYTES);
  const nl = tail.indexOf("\n");
  const body = nl >= 0 ? tail.slice(nl + 1) : tail;
  const events = parseJsonl<TranscriptEvent>(body);
  const trimmed = events.length > TRANSCRIPT_SNAPSHOT_MAX_EVENTS ? events.slice(-TRANSCRIPT_SNAPSHOT_MAX_EVENTS) : events;
  return { events: trimmed, truncated: true };
}

export async function readTranscriptSnapshot(): Promise<{ events: TranscriptEvent[]; truncated: boolean }> {
  try {
    return snapshotFromRaw(await readFile(await filePath(), "utf8"));
  } catch {
    return { events: [], truncated: false };
  }
}
