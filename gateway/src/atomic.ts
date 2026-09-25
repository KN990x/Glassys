import { randomBytes } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";

/**
 * Write `data` to `target` through a temp file and a rename, so a reader never sees a
 * half-written file. The temp name is unique per call: two writers that reach the same
 * target (a lock held by another module instance, a second process) each rename their
 * own file instead of one renaming the other's away and failing with ENOENT.
 */
export async function writeFileAtomic(
  target: string,
  data: string,
  options: { mode?: number } = {},
): Promise<void> {
  const tmp = `${target}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, data, { encoding: "utf8", ...options });
    await rename(tmp, target);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}
