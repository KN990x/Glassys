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
