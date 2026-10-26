import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 2_000;

/**
 * The workspace belongs to the agent (or to whatever repo was cloned there), so its .git/config
 * is not ours to run: core.fsmonitor names a program `git status` would execute. An observing
 * probe also takes no index lock and never waits on a prompt.
 */
export const SAFE_GIT_ARGS = ["-c", "core.fsmonitor=false", "--no-optional-locks"] as const;
export const SAFE_GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" };

export type GitContext = { branch: string; dirty: boolean };

export async function readGitContext(cwd: string): Promise<GitContext | undefined> {
  if (!cwd) return undefined;
  try {
    const { stdout: branchOut } = await execFileAsync("git", [...SAFE_GIT_ARGS, "-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], {
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
      env: SAFE_GIT_ENV,
    });
    const branch = branchOut.trim();
    if (!branch) return undefined;
    const { stdout: statusOut } = await execFileAsync("git", [...SAFE_GIT_ARGS, "-C", cwd, "status", "--porcelain"], {
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
      env: SAFE_GIT_ENV,
    });
    return { branch, dirty: statusOut.trim().length > 0 };
  } catch {
    return undefined;
  }
}
