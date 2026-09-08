import type { ServerMessage } from "@glassys/protocol";
import { asRecord, extractDiff, toolKindFromName } from "@glassys/adapter-contract";

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function mapStreamEvent(event: unknown, tools: Map<string, string>): ServerMessage[] {
  const rec = asRecord(event);
  if (!rec || typeof rec.type !== "string") return [];
  if (rec.type === "content_block_start") {
    const block = asRecord(rec.content_block);
    if (block?.type === "tool_use") {
      const id = str(block.id) ?? "tool";
      const name = str(block.name) ?? "tool";
      tools.set(id, name);
      const kind = toolKindFromName(name);
      return [{ type: "tool.start", callId: id, kind, title: name }];
    }
    return [];
  }
  if (rec.type === "content_block_delta") {
    const delta = asRecord(rec.delta);
    if (!delta) return [];
    if (delta.type === "text_delta" && str(delta.text)) return [{ type: "text.delta", text: String(delta.text) }];
    if ((delta.type === "thinking_delta" || delta.type === "reasoning_delta") && str(delta.thinking ?? delta.text)) {
      return [{ type: "thinking.delta", text: String(delta.thinking ?? delta.text) }];
    }
    return [];
  }
  if (rec.type === "content_block_stop") {
    return [];
  }
  return [];
}

function mapToolResults(content: unknown, tools: Map<string, string>): ServerMessage[] {
  if (!Array.isArray(content)) return [];
  const out: ServerMessage[] = [];
  for (const block of content) {
    const rec = asRecord(block);
    if (!rec || rec.type !== "tool_result") continue;
    const id = str(rec.tool_use_id) ?? str(rec.id) ?? "tool";
    const name = tools.get(id);
    const kind = toolKindFromName(name);
    const err = str(rec.error) || (rec.is_error === true ? "Tool failed" : undefined);
    const pulled = extractDiff(rec);
    out.push({
      type: "tool.end",
      callId: id,
      ok: !err,
      kind,
      outputPreview: typeof rec.content === "string" ? rec.content.slice(0, 4000) : undefined,
      error: err,
      diff: pulled.diff,
      stats: pulled.stats,
      truncated: pulled.truncated,
    });
  }
  return out;
}

function mapAssistantFallback(rec: Record<string, unknown>, tools: Map<string, string>): ServerMessage[] {
  const inner = asRecord(rec.message) ?? rec;
  const content = inner.content;
  if (!Array.isArray(content)) {
    const text = str(inner.text) || str(rec.text);
    return text ? [{ type: "text.delta", text }] : [];
  }
  const out: ServerMessage[] = [];
  for (const block of content) {
    const item = asRecord(block);
    if (!item) continue;
    if (item.type === "text" && str(item.text)) out.push({ type: "text.delta", text: String(item.text) });
    if (item.type === "thinking" && str(item.thinking ?? item.text)) {
      out.push({ type: "thinking.delta", text: String(item.thinking ?? item.text) });
    }
    if (item.type === "tool_use") {
      const id = str(item.id) ?? "tool";
      const name = str(item.name) ?? "tool";
      if (!tools.has(id)) {
        tools.set(id, name);
        out.push({ type: "tool.start", callId: id, kind: toolKindFromName(name), title: name });
      }
    }
  }
  return out;
}

/** Map a Claude Agent SDK message (unknown) to Glassys protocol events. */
export function mapClaudeMessage(
  message: unknown,
  tools = new Map<string, string>(),
  state?: { sawStreamEvent?: boolean },
): ServerMessage[] {
  const rec = asRecord(message);
  if (!rec || typeof rec.type !== "string") return [];
  if (rec.type === "stream_event") {
    if (state) state.sawStreamEvent = true;
    return mapStreamEvent(rec.event ?? rec, tools);
  }
  // Text/thinking/tool_use already arrive as stream_event when includePartialMessages is on.
  if (rec.type === "assistant") {
    if (!state || state.sawStreamEvent) return [];
    return mapAssistantFallback(rec, tools);
  }
  if (rec.type === "user") {
    const inner = asRecord(rec.message) ?? rec;
    return mapToolResults(inner.content, tools);
  }
  if (rec.type === "result") {
    if (rec.subtype === "error" || rec.is_error === true) {
      return [{ type: "run.error", message: str(rec.error) || str(rec.result) || "Run failed", phase: "run" }];
    }
    return [];
  }
  return [];
}

export function claudeSessionId(message: unknown): string | undefined {
  const rec = asRecord(message);
  if (!rec) return undefined;
  const nested = asRecord(rec.message) ?? rec;
  const data = asRecord(rec.data);
  return (
    str(rec.session_id) ||
    str(rec.sessionId) ||
    str(nested.session_id) ||
    str(nested.sessionId) ||
    str(data?.session_id) ||
    str(data?.sessionId)
  );
}

export function isClaudeResult(message: unknown): boolean {
  const rec = asRecord(message);
  return rec?.type === "result";
}

export function claudeResultStatus(message: unknown): "finished" | "error" {
  const rec = asRecord(message);
  if (rec?.subtype === "error" || rec?.is_error === true) return "error";
  return "finished";
}

export function claudeRunStatus(cancelled: boolean, message: unknown): "finished" | "error" | "cancelled" {
  if (cancelled) return "cancelled";
  return claudeResultStatus(message);
}
