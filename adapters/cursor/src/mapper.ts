import type { ServerMessage, ToolKind, ToolEnd } from "@glassys/protocol";
import { asRecord, diffStats, toolDenied, toolKindFromName } from "@glassys/adapter-contract";

export { toolKindFromName, diffStats };

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function pickPath(toolCall: Record<string, unknown>): string | undefined {
  const args = asRecord(toolCall.args) ?? asRecord(toolCall.arguments) ?? asRecord(toolCall.input);
  const result = asRecord(toolCall.result);
  return (
    str(toolCall.path) ??
    str(toolCall.filePath) ??
    str(toolCall.relativePath) ??
    (args ? str(args.path) ?? str(args.filePath) ?? str(args.target) : undefined) ??
    (result ? str(result.path) ?? str(result.filePath) : undefined)
  );
}

function pickCommand(toolCall: Record<string, unknown>): string | undefined {
  const args = asRecord(toolCall.args) ?? asRecord(toolCall.arguments) ?? asRecord(toolCall.input);
  return str(toolCall.command) ?? (args ? str(args.command) ?? str(args.cmd) : undefined);
}

function pickName(toolCall: Record<string, unknown>): string | undefined {
  return str(toolCall.name) || str(toolCall.type) || str(toolCall.tool) || str(toolCall.kind);
}

function titleFor(kind: ToolKind, path?: string, command?: string, name?: string): string {
  if (kind === "shell" && command) return command;
  if (path) return path;
  if (name) return name;
  return kind;
}

export function unifiedFromWrite(path: string, content: string): string {
  const lines = content.split("\n");
  const body = lines.map((line) => `+${line}`).join("\n");
  return `--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${body}`;
}

function pickDiff(toolCall: Record<string, unknown>): { diff?: string; truncated?: boolean } {
  const result = asRecord(toolCall.result);
  const args = asRecord(toolCall.args) ?? asRecord(toolCall.arguments);
  const truncatedFlag =
    bool(toolCall.truncated) ||
    bool(asRecord(toolCall.truncated)?.result) ||
    bool(asRecord(toolCall.truncated)?.args) ||
    bool(result?.truncated);

  const diffString =
    str(toolCall.diffString) ||
    str(toolCall.diff) ||
    (result && (str(result.diffString) || str(result.diff) || str(result.patch))) ||
    (args && str(args.diffString));

  if (diffString) return { diff: diffString, truncated: truncatedFlag };

  const kind = toolKindFromName(pickName(toolCall));
  if (kind === "write") {
    const path = pickPath(toolCall) ?? "file";
    const content =
      (result && (str(result.contents) || str(result.content) || str(result.text))) ||
      (args && (str(args.contents) || str(args.content)));
    if (content) return { diff: unifiedFromWrite(path, content), truncated: truncatedFlag };
  }
  return { truncated: truncatedFlag || undefined };
}

function pickOutput(toolCall: Record<string, unknown>): string | undefined {
  const result = asRecord(toolCall.result);
  if (!result) return str(toolCall.output) || str(toolCall.stdout);
  return (
    str(result.output) ||
    str(result.stdout) ||
    str(result.text) ||
    str(result.contents) ||
    (typeof result.exitCode === "number" ? `exit ${result.exitCode}` : undefined)
  );
}

function pickError(toolCall: Record<string, unknown>): string | undefined {
  const result = asRecord(toolCall.result);
  return str(toolCall.error) ?? (result ? str(result.error) ?? str(result.message) : undefined);
}

function toolCallOk(toolCall: Record<string, unknown>): boolean {
  const result = asRecord(toolCall.result);
  if (bool(toolCall.ok) === false) return false;
  const status = str(toolCall.status) || (result && str(result.status));
  if (status === "error" || status === "failed") return false;
  const exit = num(toolCall.exitCode) ?? (result && num(result.exitCode));
  if (exit !== undefined && exit !== 0) return false;
  if (pickError(toolCall) && exit !== 0) return false;
  return true;
}

function mapOneToolCall(
  type: "start" | "end",
  callId: string,
  toolCallRaw: unknown,
): ServerMessage | null {
  const toolCall = asRecord(toolCallRaw) ?? {};
  const name = pickName(toolCall);
  const kind = toolKindFromName(name);
  const path = pickPath(toolCall);
  const command = pickCommand(toolCall);
  if (type === "start") {
    return {
      type: "tool.start",
      callId,
      kind,
      title: titleFor(kind, path, command, name),
      path,
      command,
    };
  }
  const { diff, truncated } = pickDiff(toolCall);
  const outputPreview = pickOutput(toolCall);
  const error = pickError(toolCall);
  const ok = toolCallOk(toolCall) && !error;
  const end: ToolEnd = {
    type: "tool.end",
    callId,
    ok,
    kind,
    diff,
    stats: diff ? diffStats(diff) : undefined,
    outputPreview: outputPreview?.slice(0, 4000),
    error,
    truncated: truncated || undefined,
    denied: toolDenied(str(toolCall.status) || str(asRecord(toolCall.result)?.status), error) || undefined,
  };
  return end;
}

function shellChunk(event: unknown): string | undefined {
  const rec = asRecord(event);
  if (!rec) return typeof event === "string" ? event : undefined;
  return str(rec.chunk) || str(rec.data) || str(rec.output) || str(rec.text) || str(rec.stdout);
}

/**
 * Map a raw Cursor InteractionUpdate (treated as unknown) to Glassys protocol events.
 * Nested task updates are flattened into the same thread.
 */
export function mapCursorDelta(update: unknown): ServerMessage[] {
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
      const ev = mapOneToolCall("start", str(rec.callId) ?? "unknown", rec.toolCall);
      return ev ? [ev] : [];
    }
    case "tool-call-completed": {
      const ev = mapOneToolCall("end", str(rec.callId) ?? "unknown", rec.toolCall);
      return ev ? [ev] : [];
    }
    case "partial-tool-call":
      // Headless SDK streams these; Glassys paints tools on start/end only.
      return [];
    case "shell-output-delta": {
      const chunk = shellChunk(rec.event) ?? shellChunk(rec);
      const callId = str(rec.callId) ?? str(asRecord(rec.event)?.callId) ?? "shell";
      return chunk ? [{ type: "tool.progress", callId, chunk }] : [];
    }
    case "tool-call-delta": {
      return mapCursorDelta(rec.taskUpdate);
    }
    default:
      return [];
  }
}
