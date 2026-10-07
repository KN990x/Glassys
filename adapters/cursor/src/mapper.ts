import type { ServerMessage, ToolKind, ToolEnd } from "@glassys/protocol";
import { asRecord, diffStats, num, str, toolDenied, toolKindFromName, unifiedDiff } from "@glassys/adapter-contract";

export { toolKindFromName, diffStats };

/** Output previews stop here, as in every other adapter. */
const PREVIEW_CHARS = 4000;

/**
 * Per-run mapping state. Cursor's shell output deltas carry no call id, so they belong to the
 * shell call that is currently running.
 */
export type CursorMapState = { openShells: string[] };

export function cursorMapState(): CursorMapState {
  return { openShells: [] };
}

/*
 * Shapes, from @cursor/sdk's tool-call-types: a tool call is `{ type, args, result? }` and a
 * result is `{ status: "success", value }` or `{ status: "error", error }`.
 */

function argsOf(toolCall: Record<string, unknown>): Record<string, unknown> {
  return asRecord(toolCall.args) ?? {};
}

function resultOf(toolCall: Record<string, unknown>): { status?: string; value: Record<string, unknown>; error: unknown } {
  const result = asRecord(toolCall.result) ?? {};
  return { status: str(result.status), value: asRecord(result.value) ?? {}, error: result.error };
}

function pickName(toolCall: Record<string, unknown>): string | undefined {
  const args = argsOf(toolCall);
  if (toolCall.type === "mcp") return str(args.toolName) ?? "mcp";
  return str(toolCall.type) || str(toolCall.name);
}

function kindOf(toolCall: Record<string, unknown>): ToolKind {
  return toolCall.type === "mcp" ? "mcp" : toolKindFromName(pickName(toolCall));
}

function pickPath(toolCall: Record<string, unknown>): string | undefined {
  const args = argsOf(toolCall);
  return str(args.path) ?? str(args.filePath) ?? str(resultOf(toolCall).value.path);
}

function pickCommand(toolCall: Record<string, unknown>): string | undefined {
  return str(argsOf(toolCall).command);
}

function titleFor(toolCall: Record<string, unknown>, kind: ToolKind, path?: string, command?: string): string {
  if (kind === "shell" && command) return command;
  if (path) return path;
  const args = argsOf(toolCall);
  if (toolCall.type === "mcp") {
    const provider = str(args.providerIdentifier);
    const tool = str(args.toolName);
    if (provider && tool) return `${provider}/${tool}`;
  }
  return str(args.pattern) ?? str(args.query) ?? pickName(toolCall) ?? kind;
}

function pickDiff(toolCall: Record<string, unknown>, kind: ToolKind): { diff?: string; truncated?: boolean } {
  const { value } = resultOf(toolCall);
  const args = argsOf(toolCall);
  const truncated = asRecord(toolCall.truncated)?.result === true || toolCall.truncated === true || undefined;
  const diff = str(value.diffString);
  if (diff) return { diff, truncated };
  if (kind === "write") {
    const text = typeof args.fileText === "string" ? args.fileText : str(value.fileContentAfterWrite);
    if (text !== undefined) return { diff: unifiedDiff(pickPath(toolCall) ?? "file", null, text), truncated };
  }
  return { truncated };
}

function mcpText(value: Record<string, unknown>): string | undefined {
  if (!Array.isArray(value.content)) return undefined;
  const parts = value.content.map((item) => str(asRecord(asRecord(item)?.text)?.text)).filter(Boolean);
  return parts.length ? parts.join("\n") : undefined;
}

function pickOutput(toolCall: Record<string, unknown>): string | undefined {
  const { value } = resultOf(toolCall);
  const shell = [str(value.stdout), str(value.stderr)].filter(Boolean).join("");
  return shell || str(value.content) || mcpText(value) || str(value.output) || str(value.text);
}

function errorText(error: unknown): string | undefined {
  if (typeof error === "string") return error || undefined;
  const rec = asRecord(error);
  if (!rec) return undefined;
  return str(rec.message) ?? str(rec.error) ?? str(rec.reason) ?? JSON.stringify(rec);
}

function mapToolEnd(callId: string, toolCall: Record<string, unknown>): ToolEnd {
  const kind = kindOf(toolCall);
  const { status, value, error: rawError } = resultOf(toolCall);
  const exitCode = num(value.exitCode);
  const failedExit = kind === "shell" && exitCode !== undefined && exitCode !== 0;
  const error = status === "error" ? (errorText(rawError) ?? "Tool failed") : failedExit ? `exit ${exitCode}` : undefined;
  const { diff, truncated } = pickDiff(toolCall, kind);
  const added = num(value.linesAdded);
  const removed = num(value.linesRemoved);
  const stats = diff ? diffStats(diff) : added !== undefined || removed !== undefined ? { add: added ?? 0, del: removed ?? 0 } : undefined;
  return {
    type: "tool.end",
    callId,
    ok: !error,
    kind,
    diff,
    stats,
    outputPreview: pickOutput(toolCall)?.slice(0, PREVIEW_CHARS),
    error,
    truncated,
    denied: status === "error" ? toolDenied(undefined, error) || undefined : undefined,
  };
}

/**
 * Map a raw Cursor InteractionUpdate (treated as unknown) to Glassys protocol events.
 * Nested task updates are flattened into the same thread.
 */
export function mapCursorDelta(update: unknown, state: CursorMapState = cursorMapState()): ServerMessage[] {
  const rec = asRecord(update);
  if (!rec || typeof rec.type !== "string") return [];

  switch (rec.type) {
    case "text-delta":
      return str(rec.text) ? [{ type: "text.delta", text: String(rec.text) }] : [];
    case "thinking-delta":
      return str(rec.text) ? [{ type: "thinking.delta", text: String(rec.text) }] : [];
    case "thinking-completed":
      return [{ type: "thinking.done", durationMs: num(rec.thinkingDurationMs) ?? num(rec.durationMs) ?? 0 }];
    case "tool-call-started": {
      const callId = str(rec.callId) ?? "unknown";
      const toolCall = asRecord(rec.toolCall) ?? {};
      const kind = kindOf(toolCall);
      const path = pickPath(toolCall);
      const command = pickCommand(toolCall);
      if (kind === "shell") state.openShells.push(callId);
      return [{ type: "tool.start", callId, kind, title: titleFor(toolCall, kind, path, command), path, command }];
    }
    case "tool-call-completed": {
      const callId = str(rec.callId) ?? "unknown";
      state.openShells = state.openShells.filter((id) => id !== callId);
      return [mapToolEnd(callId, asRecord(rec.toolCall) ?? {})];
    }
    case "partial-tool-call":
      // Headless SDK streams these; Glassys paints tools on start/end only.
      return [];
    case "shell-output-delta": {
      /* `event` is `{ case: "stdout" | "stderr" | "exit" | "start", value: { data } }`. */
      const event = asRecord(rec.event);
      if (event?.case !== "stdout" && event?.case !== "stderr") return [];
      const chunk = str(asRecord(event.value)?.data);
      const callId = state.openShells[state.openShells.length - 1];
      return chunk && callId ? [{ type: "tool.progress", callId, chunk }] : [];
    }
    case "tool-call-delta":
      return mapCursorDelta(rec.taskUpdate, state);
    default:
      return [];
  }
}
