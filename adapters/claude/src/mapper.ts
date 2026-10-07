import type { ServerMessage } from "@glassys/protocol";
import { asRecord, extractDiff, str, toolDenied, toolKindFromName, unifiedDiff, usageFrom } from "@glassys/adapter-contract";

/*
 * Shapes, from @anthropic-ai/claude-agent-sdk's sdk.d.ts: `stream_event` carries raw Messages API
 * stream events; `assistant` the complete message; `user` the tool results, with Claude Code's
 * own structured result in `tool_use_result`; `system/permission_denied` an auto-denied call;
 * `result` the end of a turn.
 */

/** Per-session mapping state. */
export type ClaudeMapState = {
  /** Tool name per tool_use id. */
  tools: Map<string, string>;
  /** Text and thinking already arrived as stream events; the `assistant` message only adds tool input. */
  sawStreamEvent: boolean;
  thinkingStarted?: number;
  /** Tool calls a permission policy refused (dontAsk, deny rules, the classifier). */
  denied: Set<string>;
};

export function claudeMapState(): ClaudeMapState {
  return { tools: new Map(), sawStreamEvent: false, denied: new Set() };
}

const PREVIEW_CHARS = 4000;

function toolLoc(input: Record<string, unknown>): { path?: string; command?: string } {
  return {
    path: str(input.file_path) || str(input.notebook_path) || str(input.path) || str(input.filePath),
    command: str(input.command),
  };
}

function toolStart(block: Record<string, unknown>, state: ClaudeMapState): ServerMessage {
  const id = str(block.id) ?? "tool";
  const name = str(block.name) ?? state.tools.get(id) ?? "tool";
  state.tools.set(id, name);
  const loc = toolLoc(asRecord(block.input) ?? {});
  return { type: "tool.start", callId: id, kind: toolKindFromName(name), title: name, path: loc.path, command: loc.command };
}

function mapStreamEvent(event: unknown, state: ClaudeMapState): ServerMessage[] {
  const rec = asRecord(event);
  if (!rec || typeof rec.type !== "string") return [];
  if (rec.type === "content_block_start") {
    const block = asRecord(rec.content_block);
    if (block?.type === "thinking" || block?.type === "redacted_thinking") {
      state.thinkingStarted ??= Date.now();
      return [];
    }
    /* Input streams in afterwards as input_json_delta; the full input comes with `assistant`. */
    if (block?.type === "tool_use") return [toolStart(block, state)];
    return [];
  }
  if (rec.type === "content_block_delta") {
    const delta = asRecord(rec.delta);
    if (!delta) return [];
    if (delta.type === "text_delta" && str(delta.text)) return [{ type: "text.delta", text: String(delta.text) }];
    if (delta.type === "thinking_delta" && str(delta.thinking ?? delta.text)) {
      state.thinkingStarted ??= Date.now();
      return [{ type: "thinking.delta", text: String(delta.thinking ?? delta.text) }];
    }
    return [];
  }
  if (rec.type === "content_block_stop" && state.thinkingStarted !== undefined) {
    const durationMs = Math.max(0, Date.now() - state.thinkingStarted);
    state.thinkingStarted = undefined;
    return [{ type: "thinking.done", durationMs }];
  }
  return [];
}

function contentText(content: unknown): string | undefined {
  if (typeof content === "string") return content || undefined;
  if (!Array.isArray(content)) return undefined;
  const parts = content.map((block) => (asRecord(block)?.type === "text" ? str(asRecord(block)?.text) : undefined)).filter(Boolean);
  return parts.length ? parts.join("\n") : undefined;
}

/** Hunks as the `diff` package's structuredPatch writes them. */
function fromStructuredPatch(path: string, hunks: unknown[]): string | undefined {
  const body: string[] = [];
  for (const raw of hunks) {
    const hunk = asRecord(raw);
    if (!hunk || !Array.isArray(hunk.lines)) continue;
    body.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`, ...hunk.lines.map(String));
  }
  return body.length ? `--- a/${path}\n+++ b/${path}\n${body.join("\n")}` : undefined;
}

/** A diff from Claude Code's structured tool result (Edit, MultiEdit, Write). */
function toolResultDiff(result: unknown): string | undefined {
  const rec = asRecord(result);
  if (!rec) return undefined;
  const path = str(rec.filePath) ?? "file";
  if (Array.isArray(rec.structuredPatch) && rec.structuredPatch.length) {
    const diff = fromStructuredPatch(path, rec.structuredPatch);
    if (diff) return diff;
  }
  if (rec.type === "create" && typeof rec.content === "string") return unifiedDiff(path, null, rec.content);
  if (typeof rec.oldString === "string" && typeof rec.newString === "string") {
    return unifiedDiff(path, rec.oldString, rec.newString);
  }
  return undefined;
}

function mapToolResults(message: Record<string, unknown>, state: ClaudeMapState): ServerMessage[] {
  const inner = asRecord(message.message) ?? message;
  if (!Array.isArray(inner.content)) return [];
  const out: ServerMessage[] = [];
  for (const block of inner.content) {
    const rec = asRecord(block);
    if (!rec || rec.type !== "tool_result") continue;
    const id = str(rec.tool_use_id) ?? "tool";
    const text = contentText(rec.content);
    const err = rec.is_error === true ? text || "Tool failed" : undefined;
    const denied = state.denied.has(id) || (err !== undefined && toolDenied(undefined, err));
    const structured = toolResultDiff(message.tool_use_result);
    const pulled = structured ? { diff: structured, stats: undefined, truncated: undefined } : extractDiff(rec);
    out.push({
      type: "tool.end",
      callId: id,
      ok: !err,
      kind: toolKindFromName(state.tools.get(id)),
      outputPreview: text?.slice(0, PREVIEW_CHARS),
      error: err,
      denied: denied || undefined,
      diff: pulled.diff,
      stats: pulled.diff ? (pulled.stats ?? extractDiff(pulled.diff).stats) : undefined,
      truncated: pulled.truncated,
    });
  }
  return out;
}

function mapAssistant(message: Record<string, unknown>, state: ClaudeMapState): ServerMessage[] {
  const inner = asRecord(message.message) ?? message;
  const content = inner.content;
  if (!Array.isArray(content)) {
    const text = state.sawStreamEvent ? undefined : str(inner.text) || str(message.text);
    return text ? [{ type: "text.delta", text }] : [];
  }
  const out: ServerMessage[] = [];
  for (const block of content) {
    const item = asRecord(block);
    if (!item) continue;
    /* Tool input is only complete here; re-announcing the call fills in path and command. */
    if (item.type === "tool_use") {
      out.push(toolStart(item, state));
      continue;
    }
    if (state.sawStreamEvent) continue;
    if (item.type === "text" && str(item.text)) out.push({ type: "text.delta", text: String(item.text) });
    if (item.type === "thinking" && str(item.thinking ?? item.text)) {
      out.push({ type: "thinking.delta", text: String(item.thinking ?? item.text) });
    }
  }
  return out;
}

/** A result's failure in the operator's words: the SDK's `errors[]`, else what the subtype means. */
function resultError(rec: Record<string, unknown>): string | undefined {
  const subtype = str(rec.subtype);
  if (subtype === "success" && rec.is_error !== true) return undefined;
  if (!subtype && rec.is_error !== true) return undefined;
  const errors = Array.isArray(rec.errors) ? rec.errors.map(String).filter(Boolean) : [];
  if (errors.length) return errors.join("\n");
  if (subtype === "error_max_turns") return "Claude hit its turn limit";
  if (subtype === "error_max_budget_usd") return "Claude hit its budget limit";
  return str(rec.result) || "Run failed";
}

/** Map a Claude Agent SDK message (unknown) to Glassys protocol events. */
export function mapClaudeMessage(message: unknown, state: ClaudeMapState = claudeMapState()): ServerMessage[] {
  const rec = asRecord(message);
  if (!rec || typeof rec.type !== "string") return [];
  if (rec.type === "stream_event") {
    state.sawStreamEvent = true;
    return mapStreamEvent(rec.event, state);
  }
  if (rec.type === "assistant") return mapAssistant(rec, state);
  if (rec.type === "user") return mapToolResults(rec, state);
  if (rec.type === "system" && rec.subtype === "permission_denied") {
    const id = str(rec.tool_use_id);
    if (id) state.denied.add(id);
    return [];
  }
  if (rec.type === "result") {
    const out: ServerMessage[] = [];
    const error = resultError(rec);
    if (error) out.push({ type: "run.error", message: error, phase: "run" });
    const usage = usageFrom(rec.usage);
    if (usage) out.push({ type: "run.usage", ...usage });
    /* Tool ids are per turn; a long session must not keep every call it ever made. */
    state.tools.clear();
    state.denied.clear();
    return out;
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

export function claudeRunStatus(cancelled: boolean, message: unknown): "finished" | "error" | "cancelled" {
  if (cancelled) return "cancelled";
  const rec = asRecord(message);
  return rec && resultError(rec) ? "error" : "finished";
}
