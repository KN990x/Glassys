import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import type { TranscriptEvent } from "@glassys/protocol";
import { paths } from "./paths.js";

export async function appendTranscript(event: TranscriptEvent): Promise<void> {
  await mkdir(paths.data(), { recursive: true });
  await appendFile(paths.transcript(), `${JSON.stringify(event)}\n`, "utf8");
}

export async function readTranscript(): Promise<TranscriptEvent[]> {
  try {
    const raw = await readFile(paths.transcript(), "utf8");
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
  await mkdir(paths.data(), { recursive: true });
  await writeFile(paths.transcript(), "", "utf8");
}
