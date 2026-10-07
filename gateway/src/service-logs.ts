import { open, stat, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultDataDir } from "./paths.js";

/** Past this size a service log is cut down to its tail. */
export const SERVICE_LOG_MAX_BYTES = 10 * 1024 * 1024;
export const SERVICE_LOG_KEEP_BYTES = 1024 * 1024;

/**
 * launchd appends the gateway's output to glassys.log and glassys.err in the data dir, forever.
 * At start, a log past the cap keeps only its last megabyte, cut at a line. launchd holds the
 * file open for appending, so the file is rewritten in place (not replaced) and launchd's
 * later writes still land at its end. systemd sends output to the journal, which rotates itself.
 */
export async function trimServiceLogs(dir = defaultDataDir()): Promise<void> {
  for (const name of ["glassys.log", "glassys.err"]) {
    const path = join(dir, name);
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch {
      continue;
    }
    if (size <= SERVICE_LOG_MAX_BYTES) continue;
    const handle = await open(path, "r");
    let tail: Buffer;
    try {
      tail = Buffer.alloc(SERVICE_LOG_KEEP_BYTES);
      const { bytesRead } = await handle.read(tail, 0, SERVICE_LOG_KEEP_BYTES, size - SERVICE_LOG_KEEP_BYTES);
      tail = tail.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
    const nl = tail.indexOf(0x0a);
    const kept = nl >= 0 ? tail.subarray(nl + 1) : tail;
    await truncate(path, 0);
    await writeFile(path, kept, { flag: "r+" });
  }
}
