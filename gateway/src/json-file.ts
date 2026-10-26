import { readFile } from "node:fs/promises";

/**
 * Read and parse a JSON state file. A missing file is `undefined`; anything else (a typo from a
 * hand edit, EACCES, EMFILE) throws. Callers used to treat every error as "empty", and the next
 * write then replaced the real file with that empty default: a stray comma in secrets.json wiped
 * the operator password and every adapter key.
 */
export async function readJsonFile<T>(path: string): Promise<T | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`Could not read ${path}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new Error(`${path} is not valid JSON (${err instanceof Error ? err.message : String(err)}); fix or remove it`, {
      cause: err,
    });
  }
}
