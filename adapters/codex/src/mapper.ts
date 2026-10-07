import type { ServerMessage, ToolKind } from "@glassys/protocol";
import { asRecord, num, str, toolDenied, usageFrom } from "@glassys/adapter-contract";

/*
 * Shapes, from @openai/codex-sdk's index.d.ts: items are agent_message, reasoning,
 * command_execution { command, aggregated_output, exit_code, status }, file_change
 * { changes: [{ path, kind }], status }, mcp_tool_call { server, tool, result, error }, web_search,
 * todo_list and error.
 */

/** Per-run mapping state: last full text of each item, to turn snapshots into deltas. */
export type CodexMapState = { snapshots: Map<string, string> };

export function codexMapState(): CodexMapState {
  return { snapshots: new Map() };
}

const PREVIEW_CHARS = 4000;

function suffix(state: CodexMapState, key: string, text: string): string {
  const prev = state.snapshots.get(key) ?? "";
  state.snapshots.set(key, text);
  return text.startsWith(prev) ? text.slice(prev.length) : "";
}

function textDelta(state: CodexMapState, key: string, text: string, kind: "text" | "thinking"): ServerMessage[] {
  const delta = suffix(state, key, text);
  return delta ? [{ type: kind === "thinking" ? "thinking.delta" : "text.delta", text: delta }] : [];
}

function changesOf(item: Record<string, unknown>): Array<{ path: string; kind: string }> {
  if (!Array.isArray(item.changes)) return [];
  return item.changes
    .map((c) => asRecord(c))
    .filter((c): c is Record<string, unknown> => Boolean(c && str(c.path)))
    .map((c) => ({ path: String(c.path), kind: str(c.kind) ?? "update" }));
}

function toolOf(item: Record<string, unknown>): { kind: ToolKind; title: string; path?: string; command?: string } | null {
  switch (item.type) {
    case "command_execution": {
      const command = str(item.command);
      return { kind: "shell", title: command ?? "shell", command };
    }
    case "file_change": {
      const changes = changesOf(item);
      const path = changes.length === 1 ? changes[0]!.path : undefined;
      const title = changes.length > 1 ? `${changes.length} files` : (path ?? "edit");
      return { kind: "edit", title, path };
    }
    case "mcp_tool_call": {
      const server = str(item.server);
      const tool = str(item.tool);
      return { kind: "mcp", title: server && tool ? `${server}/${tool}` : (tool ?? "mcp") };
    }
    case "web_search":
      return { kind: "other", title: str(item.query) ?? "web search" };
    default:
      return null;
  }
}

function mcpOutput(item: Record<string, unknown>): string | undefined {
  const content = asRecord(item.result)?.content;
  if (!Array.isArray(content)) return undefined;
  const parts = content.map((b) => (asRecord(b)?.type === "text" ? str(asRecord(b)?.text) : undefined)).filter(Boolean);
  return parts.length ? parts.join("\n") : undefined;
}

function toolEnd(item: Record<string, unknown>, id: string, kind: ToolKind): ServerMessage {
  const status = str(item.status);
  const exit = num(item.exit_code);
  let error: string | undefined;
  if (status === "failed") {
    error = str(asRecord(item.error)?.message) ?? str(item.error) ?? (exit !== undefined ? `exit ${exit}` : "failed");
  } else if (item.type === "command_execution" && exit !== undefined && exit !== 0) {
    error = `exit ${exit}`;
  }
  const output =
    item.type === "file_change"
      ? changesOf(item)
          .map((c) => `${c.kind} ${c.path}`)
          .join("\n") || undefined
      : str(item.aggregated_output) ?? mcpOutput(item);
  return {
    type: "tool.end",
    callId: id,
    ok: !error,
    kind,
    outputPreview: output?.slice(0, PREVIEW_CHARS),
    error,
    denied: toolDenied(undefined, error) || undefined,
  };
}

export function mapCodexJsonl(line: unknown, state: CodexMapState = codexMapState()): ServerMessage[] {
  const rec = asRecord(line);
  if (!rec || typeof rec.type !== "string") return [];
  const item = asRecord(rec.item);
  if (item && (rec.type === "item.started" || rec.type === "item.updated" || rec.type === "item.completed")) {
    const id = str(item.id) ?? "item";
    if (item.type === "agent_message" && str(item.text)) return textDelta(state, id, String(item.text), "text");
    if (item.type === "reasoning" && str(item.text)) return textDelta(state, `${id}:think`, String(item.text), "thinking");
    if (item.type === "error" && rec.type === "item.completed") {
      return [{ type: "run.error", message: str(item.message) ?? "Codex error", phase: "run" }];
    }
    const tool = toolOf(item);
    if (!tool) return [];
    const out: ServerMessage[] = [];
    const startKey = `${id}:start`;
    /* file_change is only ever emitted completed; it still needs its start. */
    if (!state.snapshots.has(startKey)) {
      state.snapshots.set(startKey, "");
      out.push({ type: "tool.start", callId: id, ...tool });
    }
    if (rec.type === "item.completed") {
      state.snapshots.delete(startKey);
      state.snapshots.delete(`${id}:out`);
      out.push(toolEnd(item, id, tool.kind));
    } else if (item.type === "command_execution" && str(item.aggregated_output)) {
      const chunk = suffix(state, `${id}:out`, String(item.aggregated_output));
      if (chunk) out.push({ type: "tool.progress", callId: id, chunk });
    }
    return out;
  }
  if (rec.type === "error") {
    return [{ type: "run.error", message: str(rec.message) || "Codex error", phase: "run" }];
  }
  if (rec.type === "turn.failed") {
    return [{ type: "run.error", message: str(asRecord(rec.error)?.message) || "Turn failed", phase: "run" }];
  }
  if (rec.type === "turn.completed") {
    const usage = usageFrom(rec.usage);
    return usage ? [{ type: "run.usage", ...usage }] : [];
  }
  return [];
}

export function threadIdFromEvent(line: unknown): string | undefined {
  const rec = asRecord(line);
  return rec?.type === "thread.started" ? str(rec.thread_id) : undefined;
}

export function isCodexTurnDone(line: unknown): boolean {
  const rec = asRecord(line);
  return rec?.type === "turn.completed" || rec?.type === "turn.failed";
}
