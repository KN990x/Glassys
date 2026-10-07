import type { MessageAttachment, TranscriptEvent, ToolKind } from "@glassys/protocol";

export type ToolBlock = {
  id: string;
  kind: "tool";
  callId: string;
  toolKind: ToolKind;
  title: string;
  path?: string;
  command?: string;
  /** `stopped`: still running when the run was cancelled or failed; it never reported an end. */
  status: "running" | "done" | "error" | "denied" | "stopped";
  chunk: string;
  diff?: string;
  stats?: { add: number; del: number };
  outputPreview?: string;
  error?: string;
  truncated?: boolean;
};

export type Block =
  | {
      id: string;
      kind: "user";
      text: string;
      messageId?: string;
      attachments?: MessageAttachment[];
      pending?: boolean;
      retracted?: boolean;
      /** Its run began (`run.start` named it), and then ended. */
      started?: boolean;
      settled?: boolean;
    }
  | { id: string; kind: "thinking"; text: string; durationMs?: number }
  | { id: string; kind: "text"; text: string }
  | ToolBlock
  | { id: string; kind: "usage"; inputTokens?: number; outputTokens?: number }
  /** `code` names the gateway-defined banners; an error banner carries the message instead. */
  | { id: string; kind: "banner"; text: string; tone: "error" | "info"; code?: "cancelled" | "stalled" };

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

/*
 * A tool that never sent its end: after a clean run it finished, after a cancel or an error it
 * was cut off. Painting the cut-off ones with the green check said they had completed.
 */
function closeOpenTools(blocks: Block[], status: "done" | "stopped"): Block[] {
  let changed = false;
  const next = blocks.map((b) => {
    if (b.kind === "tool" && b.status === "running") {
      changed = true;
      return { ...b, status };
    }
    return b;
  });
  return changed ? next : blocks;
}

/** A stall warning only holds until the agent says something again, or the run ends. */
function dropStall(blocks: Block[]): Block[] {
  return blocks.some((b) => b.kind === "banner" && b.code === "stalled")
    ? blocks.filter((b) => !(b.kind === "banner" && b.code === "stalled"))
    : blocks;
}

function closeOpenWork(blocks: Block[], status: "done" | "stopped"): Block[] {
  return dropStall(closeOpenThinking(closeOpenTools(blocks, status)));
}

export function reduceTranscript(blocks: Block[], event: TranscriptEvent): Block[] {
  return applyEvent(blocks.slice(), event);
}

/** A batch of events with one copy of the block list, not one per event. */
export function reduceTranscriptBatch(blocks: Block[], events: TranscriptEvent[]): Block[] {
  let next = blocks.slice();
  for (const event of events) next = applyEvent(next, event);
  return next;
}

/** Apply one event to `next`, which the caller owns; returns it or a replacement. */
function applyEvent(next: Block[], event: TranscriptEvent): Block[] {
  let at = outputAt(next);
  const before = next[at - 1];
  if (event.type !== "run.stalled" && before?.kind === "banner" && before.code === "stalled") {
    next.splice(at - 1, 1);
    at -= 1;
  }
  const last = next[at - 1];
  const put = (block: Block) => {
    next.splice(at, 0, block);
    return next;
  };

  switch (event.type) {
    case "user.message":
      next.push({
        id: event.id ? `msg:${event.id}` : nid("u"),
        kind: "user",
        text: event.text,
        messageId: event.id,
        attachments: event.attachments,
      });
      return next;
    case "user.retracted": {
      const idx = next.findIndex((b) => b.kind === "user" && b.messageId === event.id);
      if (idx >= 0 && next[idx].kind === "user") {
        next[idx] = { ...next[idx], retracted: true, pending: false };
      }
      return next;
    }
    case "thinking.delta": {
      if (last?.kind === "thinking" && last.durationMs === undefined) {
        next[at - 1] = { ...last, text: last.text + event.text };
        return next;
      }
      return put({ id: nid("th"), kind: "thinking", text: event.text });
    }
    case "thinking.done": {
      for (let i = next.length - 1; i >= 0; i--) {
        const b = next[i];
        if (b.kind === "thinking" && b.durationMs === undefined) {
          next[i] = { ...b, durationMs: event.durationMs };
          return next;
        }
      }
      return put({ id: nid("th"), kind: "thinking", text: "", durationMs: event.durationMs });
    }
    case "text.delta": {
      if (last?.kind === "text") {
        next[at - 1] = { ...last, text: last.text + event.text };
        return next;
      }
      return put({ id: nid("tx"), kind: "text", text: event.text });
    }
    case "tool.start": {
      const idx = findTool(next, event.callId);
      const cur = idx >= 0 ? next[idx] : undefined;
      /* Some agents number calls per turn (Codex's item_0, item_1…): a start for an id whose
         call already finished is a new call, not a refinement of the old one. */
      if (cur?.kind === "tool" && cur.status === "running") {
        next[idx] = {
          ...cur,
          title: event.title || cur.title,
          path: event.path ?? cur.path,
          command: event.command ?? cur.command,
          toolKind: event.kind || cur.toolKind,
        };
        return next;
      }
      return put({
        id: cur ? nid(`tool:${event.callId}:`) : `tool:${event.callId}`,
        kind: "tool",
        callId: event.callId,
        toolKind: event.kind,
        title: event.title,
        path: event.path,
        command: event.command,
        status: "running",
        chunk: "",
      });
    }
    case "tool.progress": {
      const idx = findTool(next, event.callId);
      if (idx >= 0 && next[idx].kind === "tool") {
        const t = next[idx];
        next[idx] = { ...t, chunk: capChunk(t.chunk + (event.chunk ?? "")) };
      }
      return next;
    }
    case "tool.end": {
      const idx = findTool(next, event.callId);
      const patch: Partial<ToolBlock> = {
        status: event.denied ? "denied" : event.ok ? "done" : "error",
        toolKind: event.kind,
        diff: event.diff,
        stats: event.stats,
        outputPreview: event.outputPreview,
        error: event.error,
        truncated: event.truncated,
      };
      if (idx >= 0 && next[idx].kind === "tool") {
        next[idx] = { ...next[idx], ...patch };
        return next;
      }
      return put({
        id: `tool:${event.callId}`,
        kind: "tool",
        callId: event.callId,
        toolKind: event.kind,
        title: event.kind,
        status: "error",
        chunk: "",
        ...patch,
      });
    }
    case "run.queued":
      return next;
    case "run.start": {
      for (let i = next.length - 1; i >= 0; i--) {
        const b = next[i];
        if (b.kind === "user" && event.messageId && b.messageId === event.messageId) {
          next[i] = { ...b, started: true };
          break;
        }
      }
      return next;
    }
    case "run.error":
      put({ id: nid("err"), kind: "banner", text: event.message, tone: "error" });
      return closeOpenWork(settleRun(next), "stopped");
    case "run.cancelled":
      put({ id: nid("c"), kind: "banner", text: "", tone: "info", code: "cancelled" });
      return closeOpenWork(settleRun(next), "stopped");
    case "run.done":
      return closeOpenWork(settleRun(next), "done");
    case "run.stalled":
      if (next.some((b) => b.kind === "banner" && b.code === "stalled")) return next;
      return put({ id: nid("stall"), kind: "banner", text: "", tone: "info", code: "stalled" });
    case "run.usage":
      return put({ id: nid("use"), kind: "usage", inputTokens: event.inputTokens, outputTokens: event.outputTokens });
    default:
      return next;
  }
}

/* A long build streams megabytes of shell output; the card only ever shows the
   tail, so the rest is dropped instead of re-concatenated on every delta. */
export const MAX_TOOL_CHUNK = 64 * 1024;

function capChunk(chunk: string): string {
  if (chunk.length <= MAX_TOOL_CHUNK) return chunk;
  const cut = chunk.length - MAX_TOOL_CHUNK;
  const nl = chunk.indexOf("\n", cut);
  return chunk.slice(nl >= 0 && nl < chunk.length - 1 ? nl + 1 : cut);
}

/**
 * Where the running turn writes. A message sent during a run is saved when it is queued, so it
 * sits in the middle of that run's events; the run's later output still belongs above it, not
 * split around it. While the message `run.start` named has not settled, output goes before the
 * first message waiting behind it. Transcripts from before `run.start` named messages, and
 * messages whose run never started, just append.
 */
function outputAt(blocks: Block[]): number {
  let waiting = -1;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.kind !== "user") continue;
    if (b.started) return b.settled || waiting < 0 ? blocks.length : waiting;
    if (!b.retracted) waiting = i;
  }
  return blocks.length;
}

/** The run of the last message that started is over. */
function settleRun(blocks: Block[]): Block[] {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.kind === "user" && b.started) {
      if (!b.settled) blocks[i] = { ...b, settled: true };
      break;
    }
  }
  return blocks;
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
  return reduceTranscriptBatch([], events);
}
