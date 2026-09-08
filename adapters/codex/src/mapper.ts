import type { ServerMessage } from "@glassys/protocol";
import { asRecord, extractDiff, toolDenied, toolKindFromName } from "@glassys/adapter-contract";

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function snapshotDelta(
  snapshots: Map<string, string>,
  id: string,
  text: string,
  kind: "text" | "thinking",
): ServerMessage[] {
  const prev = snapshots.get(id) ?? "";
  if (!text || text === prev) return [];
  snapshots.set(id, text);
  const delta = text.startsWith(prev) ? text.slice(prev.length) : text;
  if (!delta) return [];
  return [{ type: kind === "thinking" ? "thinking.delta" : "text.delta", text: delta }];
}

export function mapCodexJsonl(
  line: unknown,
  tools = new Map<string, string>(),
  snapshots = new Map<string, string>(),
): ServerMessage[] {
  const rec = asRecord(line);
  if (!rec || typeof rec.type !== "string") return [];
  const item = asRecord(rec.item);
  if (rec.type === "item.started" && item) {
    const id = str(item.id) ?? "item";
    const type = str(item.type) ?? "";
    if (type === "command_execution" || type === "mcp_tool_call") {
      const name = str(item.command) || str(item.name) || type;
      tools.set(id, name);
      return [
        {
          type: "tool.start",
          callId: id,
          kind: toolKindFromName(type === "command_execution" ? "shell" : name),
          title: name,
          command: str(item.command),
        },
      ];
    }
    if (type === "file_change") {
      tools.set(id, "edit");
      return [{ type: "tool.start", callId: id, kind: "edit", title: str(item.path) || "edit", path: str(item.path) || str(item.file) }];
    }
    return [];
  }
  if (rec.type === "item.completed" && item) {
    const id = str(item.id) ?? "item";
    const type = str(item.type) ?? "";
    if (type === "agent_message" && str(item.text)) {
      return snapshotDelta(snapshots, id, String(item.text), "text");
    }
    if (type === "reasoning" && str(item.text)) {
      return snapshotDelta(snapshots, `${id}:think`, String(item.text), "thinking");
    }
    if (type === "command_execution" || type === "mcp_tool_call" || type === "file_change") {
      const ok = str(item.status) !== "failed";
      const kind = toolKindFromName(type === "command_execution" ? "shell" : tools.get(id) || type);
      const { diff, stats, truncated } = extractDiff(item);
      const err = ok ? undefined : str(item.error) || "failed";
      return [
        {
          type: "tool.end",
          callId: id,
          ok,
          kind,
          outputPreview: str(item.output) || str(item.aggregated_output),
          error: err,
          denied: toolDenied(str(item.status), err) || undefined,
          diff,
          stats,
          truncated,
        },
      ];
    }
    return [];
  }
  if (rec.type === "item.updated" && item) {
    const id = str(item.id) ?? "item";
    const type = str(item.type);
    if (type === "agent_message" && str(item.text)) {
      return snapshotDelta(snapshots, id, String(item.text), "text");
    }
    if (type === "reasoning" && str(item.text)) {
      return snapshotDelta(snapshots, `${id}:think`, String(item.text), "thinking");
    }
    if (type === "command_execution" || type === "mcp_tool_call") {
      const text = str(item.aggregated_output) || str(item.output);
      if (!text) return [];
      const key = `tool:${id}`;
      const prev = snapshots.get(key) ?? "";
      if (text === prev) return [];
      const delta = text.startsWith(prev) ? text.slice(prev.length) : text;
      snapshots.set(key, text);
      return delta ? [{ type: "tool.progress", callId: id, chunk: delta }] : [];
    }
    return [];
  }
  if (rec.type === "error") {
    return [{ type: "run.error", message: str(rec.message) || "Codex error", phase: "run" }];
  }
  if (rec.type === "turn.failed") {
    const err = asRecord(rec.error);
    return [{ type: "run.error", message: str(err?.message) || "Turn failed", phase: "run" }];
  }
  if (rec.type === "turn.completed") {
    const usage = asRecord(rec.usage);
    if (!usage) return [];
    const inputTokens =
      typeof usage.input_tokens === "number"
        ? usage.input_tokens
        : typeof usage.inputTokens === "number"
          ? usage.inputTokens
          : undefined;
    const outputTokens =
      typeof usage.output_tokens === "number"
        ? usage.output_tokens
        : typeof usage.outputTokens === "number"
          ? usage.outputTokens
          : undefined;
    if (inputTokens == null && outputTokens == null) return [];
    return [{ type: "run.usage", inputTokens, outputTokens }];
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
