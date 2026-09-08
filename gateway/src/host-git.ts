import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 2_000;

export type GitContext = { branch: string; dirty: boolean };

export async function readGitContext(cwd: string): Promise<GitContext | undefined> {
  if (!cwd) return undefined;
  try {
    const { stdout: branchOut } = await execFileAsync("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], {
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
    });
    const branch = branchOut.trim();
    if (!branch) return undefined;
    const { stdout: statusOut } = await execFileAsync("git", ["-C", cwd, "status", "--porcelain"], {
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
    });
    return { branch, dirty: statusOut.trim().length > 0 };
  } catch {
    return undefined;
  }
}
