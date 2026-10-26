import type { ChildProcess } from "node:child_process";

/** Spawn children in their own process group, so a signal reaches what they started too. */
export const OWN_GROUP = process.platform !== "win32";

export function signalTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (OWN_GROUP && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      /* group already gone; fall through to the child itself */
    }
  }
  child.kill(signal);
}
