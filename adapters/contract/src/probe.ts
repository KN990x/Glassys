import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AdapterError } from "./types.js";

const execFileAsync = promisify(execFile);

/** Fail probe when a host CLI binary is missing from PATH. */
export async function requireHostCommand(command: string, message: string): Promise<void> {
  const finder = process.platform === "win32" ? "where" : "which";
  try {
    await execFileAsync(finder, [command], { timeout: 4_000, windowsHide: true });
  } catch {
    throw new AdapterError(message, "startup");
  }
}

/**
 * Fail probe when a host CLI is on PATH but does not run: an install that crashes on launch (a
 * binary the OS kills, a broken runtime) is as unusable as a missing one, and saying "install it"
 * sent the operator to fix the wrong thing.
 */
export async function requireRunnableCommand(command: string, args: string[], name: string): Promise<void> {
  await requireHostCommand(command, `${name} CLI is not on PATH. Install the ${name} CLI on this host.`);
  try {
    await execFileAsync(command, args, { timeout: 15_000, windowsHide: true });
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { signal?: string; code?: number | string; stderr?: string };
    const why = e.signal ? `was killed (${e.signal})` : e.code !== undefined ? `exited with ${e.code}` : "failed";
    const detail = typeof e.stderr === "string" && e.stderr.trim() ? `: ${e.stderr.trim().split("\n").slice(-1)[0]}` : "";
    throw new AdapterError(`\`${command} ${args.join(" ")}\` ${why}${detail}. The ${name} CLI is installed but does not run on this host.`, "startup");
  }
}
