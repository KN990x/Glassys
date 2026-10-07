import type { ServerMessage } from "@glassys/protocol";
import { asRecord, extractDiff, str, toolDenied, toolKindFromName } from "@glassys/adapter-contract";


function mapContent(content: unknown): ServerMessage[] {
  const rec = asRecord(content);
  if (!rec) {
    if (typeof content === "string" && content) return [{ type: "text.delta", text: content }];
    return [];
  }
  const type = str(rec.type) || "";
  if (type === "text" && str(rec.text)) return [{ type: "text.delta", text: String(rec.text) }];
  if ((type === "thought" || type === "thinking") && str(rec.text)) return [{ type: "thinking.delta", text: String(rec.text) }];
  return [];
}

function previewFromContent(content: unknown): string | undefined {
  if (typeof content === "string" && content) return content.slice(0, 4000);
  if (!Array.isArray(content)) {
    const rec = asRecord(content);
    if (rec && typeof rec.text === "string") return rec.text.slice(0, 4000);
    return undefined;
  }
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "string") {
      parts.push(block);
      continue;
    }
    const rec = asRecord(block);
    if (!rec) continue;
    if (typeof rec.text === "string") parts.push(rec.text);
    const nested = asRecord(rec.content);
    if (nested && typeof nested.text === "string") parts.push(nested.text);
  }
  const joined = parts.join("");
  return joined ? joined.slice(0, 4000) : undefined;
}

/** Per-turn mapping state: each call's tool name, and how much of its output was already shown. */
export type AcpMapState = { tools: Map<string, string>; shown: Map<string, string> };

export function acpMapState(): AcpMapState {
  return { tools: new Map(), shown: new Map() };
}

function toolEnd(id: string, status: string, update: Record<string, unknown>, state: AcpMapState): ServerMessage {
  const { diff, stats, truncated } = extractDiff(update);
  const err = status === "failed" || status === "cancelled" ? str(update.error) || status : undefined;
  return {
    type: "tool.end",
    callId: id,
    ok: status === "completed",
    kind: toolKindFromName(state.tools.get(id)),
    outputPreview: previewFromContent(update.content) || str(update.rawOutput) || str(update.output),
    error: err,
    denied: toolDenied(status, err) || undefined,
    diff,
    stats,
    truncated,
  };
}

/**
 * ACP sends a tool call's content whole on every update. Show only what is new since the last
 * one; content that was rewritten rather than extended has nothing appendable to show.
 */
function progress(id: string, update: Record<string, unknown>, state: AcpMapState): ServerMessage[] {
  const full = previewFromContent(update.content) || str(update.rawOutput) || str(update.output);
  if (!full) return [];
  const before = state.shown.get(id) ?? "";
  state.shown.set(id, full);
  if (!full.startsWith(before) || full.length === before.length) return [];
  return [{ type: "tool.progress", callId: id, chunk: full.slice(before.length) }];
}

function toolStart(id: string, update: Record<string, unknown>, state: AcpMapState): ServerMessage {
  const kindName = str(update.kind) || str(update.toolName) || str(update.title) || state.tools.get(id) || "tool";
  state.tools.set(id, kindName);
  const loc = Array.isArray(update.locations) ? asRecord(update.locations[0]) : asRecord(update.locations);
  const raw = asRecord(update.rawInput);
  return {
    type: "tool.start",
    callId: id,
    kind: toolKindFromName(kindName),
    title: str(update.title) || str(update.toolName) || str(update.kind) || "tool",
    path: str(update.path) || str(loc?.path) || str(raw?.path) || str(raw?.file_path),
    command: str(update.command) || str(raw?.command),
  };
}

const DONE = new Set(["completed", "failed", "cancelled"]);

export function mapAcpUpdate(params: unknown, state: AcpMapState = acpMapState()): ServerMessage[] {
  const rec = asRecord(params);
  if (!rec) return [];
  const update = asRecord(rec.update) ?? rec;
  const sessionUpdate = str(update.sessionUpdate) || str(update.type) || "";
  if (sessionUpdate === "agent_message_chunk" || sessionUpdate === "agent_thought_chunk") {
    const content = update.content ?? update;
    const events = mapContent(content);
    if (sessionUpdate === "agent_thought_chunk") {
      return events.map((e) => (e.type === "text.delta" ? { type: "thinking.delta" as const, text: e.text } : e));
    }
    return events;
  }
  const id = str(update.toolCallId) || str(update.toolCallID) || "tool";
  const status = str(update.status);
  if (sessionUpdate === "tool_call") {
    const start = toolStart(id, update, state);
    /* A call can arrive already finished (a fast read); it still needs its end. */
    return status && DONE.has(status) ? [start, toolEnd(id, status, update, state)] : [start];
  }
  if (sessionUpdate === "tool_call_update") {
    if (status && DONE.has(status)) {
      state.shown.delete(id);
      return [toolEnd(id, status, update, state)];
    }
    const out: ServerMessage[] = [];
    /* Updates without a status refine the call: a better title, its location, its input. */
    if (!status && (str(update.title) || str(update.kind) || update.locations || update.rawInput)) {
      out.push(toolStart(id, update, state));
    }
    out.push(...progress(id, update, state));
    return out;
  }
  return [];
}
