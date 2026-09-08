import type { ServerMessage } from "@glassys/protocol";
import { asRecord, extractDiff, toolKindFromName } from "@glassys/adapter-contract";

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

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

export function mapAcpUpdate(params: unknown, tools = new Map<string, string>()): ServerMessage[] {
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
  if (sessionUpdate === "tool_call") {
    const id = str(update.toolCallId) || str(update.toolCallID) || "tool";
    const name = str(update.title) || str(update.kind) || str(update.toolName) || "tool";
    tools.set(id, name);
    const loc = Array.isArray(update.locations) ? asRecord(update.locations[0]) : asRecord(update.locations);
    return [
      {
        type: "tool.start",
        callId: id,
        kind: toolKindFromName(name),
        title: name,
        path: str(update.path) || str(loc?.path),
      },
    ];
  }
  if (sessionUpdate === "tool_call_update") {
    const id = str(update.toolCallId) || str(update.toolCallID) || "tool";
    const status = str(update.status);
    if (status === "completed" || status === "failed") {
      const { diff, stats, truncated } = extractDiff(update);
      return [
        {
          type: "tool.end",
          callId: id,
          ok: status === "completed",
          kind: toolKindFromName(tools.get(id)),
          outputPreview: previewFromContent(update.content) || str(update.output),
          error: status === "failed" ? str(update.error) || "failed" : undefined,
          diff,
          stats,
          truncated,
        },
      ];
    }
  }
  return [];
}
