import type { ServerMessage } from "@glassys/protocol";
import { asRecord, extractDiff, toolKindFromName } from "@glassys/adapter-contract";

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export function mapGeminiChunk(chunk: unknown, tools = new Map<string, string>()): ServerMessage[] {
  const rec = asRecord(chunk);
  if (!rec) {
    if (typeof chunk === "string" && chunk) return [{ type: "text.delta", text: chunk }];
    return [];
  }
  const type = str(rec.type) || str(rec.kind) || "";
  if (typeof rec.value === "string" && rec.value) {
    if (type === "thought" || type === "thinking" || type === "reasoning") {
      return [{ type: "thinking.delta", text: rec.value }];
    }
    if (type === "content" || type === "text" || type === "output" || !type) {
      return [{ type: "text.delta", text: rec.value }];
    }
  }
  const value = asRecord(rec.value) ?? rec;
  if (type === "content" || type === "text" || type === "output") {
    const text = str(value.text) || str(rec.text) || str(rec.delta);
    return text ? [{ type: "text.delta", text }] : [];
  }
  if (type === "thought" || type === "thinking" || type === "reasoning") {
    const text = str(value.text) || str(rec.text) || str(rec.thought);
    return text ? [{ type: "thinking.delta", text }] : [];
  }
  if (type === "tool_call" || type === "tool" || type === "toolCall") {
    const id = str(rec.callId) || str(rec.id) || str(value.id) || "tool";
    const name = str(rec.name) || str(value.name) || str(rec.tool) || "tool";
    const status = str(rec.status) || str(value.status);
    const ended = status === "done" || status === "completed" || status === "error";
    const out: ServerMessage[] = [];
    if (!tools.has(id) || status === "start" || status === "started") {
      tools.set(id, name);
      out.push({ type: "tool.start", callId: id, kind: toolKindFromName(name), title: name });
    }
    if (ended) {
      const pulled = extractDiff(value);
      const fromRec = extractDiff(rec);
      const diff = pulled.diff || fromRec.diff;
      out.push({
        type: "tool.end",
        callId: id,
        ok: status !== "error",
        kind: toolKindFromName(tools.get(id) || name),
        outputPreview: str(value.output) || str(rec.output),
        error: status === "error" ? str(rec.error) || "Tool failed" : undefined,
        diff,
        stats: pulled.stats || fromRec.stats,
        truncated: pulled.truncated || fromRec.truncated,
      });
    }
    return out;
  }
  const text = str(rec.text);
  return text ? [{ type: "text.delta", text }] : [];
}
