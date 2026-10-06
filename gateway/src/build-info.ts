import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** The Glassys clone this gateway was started from (gateway/dist/.. /..). */
export function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../..");
}

export const GATEWAY_VERSION = (() => {
  try {
    const pkg = join(dirname(fileURLToPath(import.meta.url)), "../package.json");
    const parsed = JSON.parse(readFileSync(pkg, "utf8")) as { version?: string };
    return parsed.version || "0.1.0";
  } catch {
    return "0.1.0";
  }
})();

/** When this process started serving, and the commit it was started on. */
const running: { commit?: string; startedAt: string } = { startedAt: new Date().toISOString() };

/**
 * Read once at start: `HEAD` on disk can move (a pull, an upgrade) while this process keeps
 * serving the old code, and that gap is exactly what /health and the Updates tab must show.
 */
export async function initBuildInfo(): Promise<void> {
  if (!existsSync(join(repoRoot(), ".git"))) return;
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoRoot(), "rev-parse", "HEAD"], {
      timeout: 5000,
      windowsHide: true,
    });
    const sha = stdout.trim();
    if (/^[0-9a-f]{40,64}$/.test(sha)) running.commit = sha;
  } catch {
    /* Not a clone, or git is missing: /health simply omits the commit. */
  }
}

export function runningBuild(): { commit?: string; startedAt: string } {
  return { ...running };
}

export function setRunningCommitForTests(commit: string | undefined): void {
  running.commit = commit;
}
