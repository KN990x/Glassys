import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { TranscriptEvent } from "@glassys/protocol";
import { ensureLiveThread, liveTranscriptPath } from "./threads.js";

async function filePath(): Promise<string> {
  await ensureLiveThread();
  return liveTranscriptPath();
}

export async function appendTranscript(event: TranscriptEvent): Promise<void> {
  const path = await filePath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(event)}\n`, { encoding: "utf8", flag: "a" });
}

export async function readTranscript(): Promise<TranscriptEvent[]> {
  try {
    const raw = await readFile(await filePath(), "utf8");
    const events: TranscriptEvent[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as TranscriptEvent);
      } catch {
        /* skip corrupt line */
      }
    }
    return events;
  } catch {
    return [];
  }
}

export async function clearTranscript(): Promise<void> {
  const path = await filePath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "", "utf8");
}
