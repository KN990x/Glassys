import type { TranscriptEvent, ToolKind } from "@glassys/protocol";

export type ToolBlock = {
  id: string;
  kind: "tool";
  callId: string;
  toolKind: ToolKind;
  title: string;
  path?: string;
  command?: string;
  status: "running" | "done" | "error";
  chunk: string;
  diff?: string;
  stats?: { add: number; del: number };
  outputPreview?: string;
  error?: string;
  truncated?: boolean;
};

export type Block =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "thinking"; text: string; durationMs?: number }
  | { id: string; kind: "text"; text: string }
  | ToolBlock
  | { id: string; kind: "banner"; text: string; tone: "queue" | "error" | "info" };

let generation = 0;
let seq = 0;
const nid = (prefix: string) => `${prefix}${generation}-${++seq}`;

function closeOpenThinking(blocks: Block[]): Block[] {
  let changed = false;
  const next = blocks.map((b) => {
    if (b.kind === "thinking" && b.durationMs === undefined) {
      changed = true;
      return { ...b, durationMs: 0 };
    }
    return b;
  });
  return changed ? next : blocks;
}

export function reduceTranscript(blocks: Block[], event: TranscriptEvent): Block[] {
  const next = blocks.slice();
  const last = next[next.length - 1];

  switch (event.type) {
    case "user.message":
      next.push({ id: nid("u"), kind: "user", text: event.text });
      return next;
    case "thinking.delta": {
      if (last?.kind === "thinking" && last.durationMs === undefined) {
        next[next.length - 1] = { ...last, text: last.text + event.text };
        return next;
      }
      next.push({ id: nid("th"), kind: "thinking", text: event.text });
      return next;
    }
    case "thinking.done": {
      for (let i = next.length - 1; i >= 0; i--) {
        const b = next[i];
        if (b.kind === "thinking" && b.durationMs === undefined) {
          next[i] = { ...b, durationMs: event.durationMs };
          return next;
        }
      }
      next.push({ id: nid("th"), kind: "thinking", text: "", durationMs: event.durationMs });
      return next;
    }
    case "text.delta": {
      if (last?.kind === "text") {
        next[next.length - 1] = { ...last, text: last.text + event.text };
        return next;
      }
      next.push({ id: nid("tx"), kind: "text", text: event.text });
      return next;
    }
    case "tool.start":
      next.push({
        id: `tool:${event.callId}`,
        kind: "tool",
        callId: event.callId,
        toolKind: event.kind,
        title: event.title,
        path: event.path,
        command: event.command,
        status: "running",
        chunk: "",
      });
      return next;
    case "tool.progress": {
      const idx = findTool(next, event.callId);
      if (idx >= 0 && next[idx].kind === "tool") {
        const t = next[idx];
        next[idx] = { ...t, chunk: t.chunk + (event.chunk ?? "") };
      }
      return next;
    }
    case "tool.end": {
      const idx = findTool(next, event.callId);
      const patch: Partial<ToolBlock> = {
        status: event.ok ? "done" : "error",
        toolKind: event.kind,
        diff: event.diff,
        stats: event.stats,
        outputPreview: event.outputPreview,
        error: event.error,
        truncated: event.truncated,
      };
      if (idx >= 0 && next[idx].kind === "tool") {
        next[idx] = { ...next[idx], ...patch };
      } else {
        next.push({
          id: `tool:${event.callId}`,
          kind: "tool",
          callId: event.callId,
          toolKind: event.kind,
          title: event.kind,
          status: event.ok ? "done" : "error",
          chunk: "",
          ...patch,
        });
      }
      return next;
    }
    case "run.queued":
      return next;
    case "run.start":
      return next.filter((b) => !(b.kind === "banner" && b.tone === "queue"));
    case "run.error":
      next.push({ id: nid("err"), kind: "banner", text: event.message, tone: "error" });
      return closeOpenThinking(next);
    case "run.cancelled":
      next.push({ id: nid("c"), kind: "banner", text: "cancelled", tone: "info" });
      return closeOpenThinking(next);
    case "run.done":
      return closeOpenThinking(next);
    default:
      return next;
  }
}

function findTool(blocks: Block[], callId: string): number {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.kind === "tool" && b.callId === callId) return i;
  }
  return -1;
}

export function replay(events: TranscriptEvent[]): Block[] {
  generation += 1;
  seq = 0;
  return events.reduce<Block[]>((acc, ev) => reduceTranscript(acc, ev), []);
}
