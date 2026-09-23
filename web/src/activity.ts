import type { Block, ToolBlock } from "./transcript";

export type ActivityCommand = {
  id: string;
  command: string;
  title: string;
  status: ToolBlock["status"];
  lines: number;
};

export type ActivityFile = {
  path: string;
  /** A file the agent only looked at is not the same as one it rewrote. */
  changed: boolean;
  add: number;
  del: number;
  touches: number;
  /** The last diff seen for this path, so the row can show it. */
  diff?: string;
  id: string;
};

export type Activity = {
  commands: ActivityCommand[];
  files: ActivityFile[];
  usage: { inputTokens: number; outputTokens: number };
};

const CHANGE_KINDS = new Set(["write", "edit"]);

/**
 * What this thread actually did to the host, read back off the transcript.
 *
 * It is the systems-work answer to a code UI's Git and Files panels: which
 * commands ran and how they ended, and which files were read or rewritten.
 * Nothing new is collected — the gateway already sent all of it — so the panel
 * cannot disagree with the transcript beside it.
 */
export function deriveActivity(blocks: Block[]): Activity {
  const commands: ActivityCommand[] = [];
  const byPath = new Map<string, ActivityFile>();
  const usage = { inputTokens: 0, outputTokens: 0 };

  for (const block of blocks) {
    if (block.kind === "usage") {
      usage.inputTokens += block.inputTokens ?? 0;
      usage.outputTokens += block.outputTokens ?? 0;
      continue;
    }
    if (block.kind !== "tool") continue;

    if (block.command) {
      commands.push({
        id: block.id,
        command: block.command,
        title: block.title,
        status: block.status,
        lines: block.chunk ? block.chunk.split("\n").length : 0,
      });
    }

    const path = block.path;
    if (!path) continue;
    const changed = CHANGE_KINDS.has(block.toolKind) || Boolean(block.diff) || Boolean(block.stats);
    const existing = byPath.get(path);
    const entry: ActivityFile = existing ?? {
      path,
      changed: false,
      add: 0,
      del: 0,
      touches: 0,
      id: block.id,
    };
    entry.touches += 1;
    entry.changed = entry.changed || changed;
    entry.add += block.stats?.add ?? 0;
    entry.del += block.stats?.del ?? 0;
    if (block.diff) entry.diff = block.diff;
    /* The row jumps to the most recent call for that path. */
    entry.id = block.id;
    byPath.set(path, entry);
  }

  // Rewritten files first: they are what an operator checks before walking away.
  const files = [...byPath.values()].sort((a, b) => Number(b.changed) - Number(a.changed));
  return { commands, files, usage };
}
