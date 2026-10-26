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

/**
 * Built per call, not when the module loads: imports run before main() seals the session secrets
 * out of process.env, and a copy taken then would hand them to every git child.
 */
export function safeGitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" };
}

export type GitContext = { branch: string; dirty: boolean };

function git(cwd: string, args: string[]) {
  return execFileAsync("git", [...SAFE_GIT_ARGS, "-C", cwd, ...args], {
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
    env: safeGitEnv(),
  });
}

/**
 * Whether the work tree differs from HEAD, without `git status`: status re-hashes files whose stat
 * changed, which runs any `filter.<x>.clean` driver the repo's own config and .gitattributes name.
 * diff-index compares stat data only (a file touched but unchanged counts as dirty), and ls-files
 * lists untracked paths; neither runs a filter.
 */
async function workTreeDirty(cwd: string): Promise<boolean> {
  try {
    await git(cwd, ["diff-index", "--quiet", "--no-ext-diff", "--no-textconv", "HEAD", "--"]);
  } catch (err) {
    if ((err as { code?: unknown }).code === 1) return true;
    throw err;
  }
  const { stdout } = await git(cwd, ["ls-files", "--others", "--exclude-standard", "--directory", "--no-empty-directory"]);
  return stdout.trim().length > 0;
}

export async function readGitContext(cwd: string): Promise<GitContext | undefined> {
  if (!cwd) return undefined;
  try {
    const { stdout: branchOut } = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const branch = branchOut.trim();
    if (!branch) return undefined;
    return { branch, dirty: await workTreeDirty(cwd) };
  } catch {
    return undefined;
  }
}
