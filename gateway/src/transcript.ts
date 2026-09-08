import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { TranscriptEvent } from "@glassys/protocol";
import { ensureLiveThread, liveTranscriptPath, refreshLiveTitle } from "./threads.js";
import { parseJsonl } from "./jsonl.js";

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

export async function clearTranscript(): Promise<void> {
  const path = await filePath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "", "utf8");
}
