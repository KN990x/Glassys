import type { ServerMessage } from "@glassys/protocol";
import { asRecord, extractDiff, toolDenied, toolKindFromName } from "@glassys/adapter-contract";

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function partType(part: Record<string, unknown>): string {
  return str(part.type) || str(part.kind) || "";
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

function mapPart(partRaw: unknown, tools: Map<string, string>, snapshots: Map<string, string>): ServerMessage[] {
  const part = asRecord(partRaw);
  if (!part) return [];
  const type = partType(part);
  if (type === "text" || type === "output-text") {
    const text = str(part.text) || str(part.delta) || str(asRecord(part.content)?.text);
    const id = str(part.id) || str(part.callID) || "text";
    return text ? snapshotDelta(snapshots, id, text, "text") : [];
  }
  if (type === "reasoning" || type === "thinking") {
    const text = str(part.text) || str(part.delta);
    const id = str(part.id) || "thinking";
    return text ? snapshotDelta(snapshots, id, text, "thinking") : [];
  }
    if (type === "tool" || type === "tool_call" || type === "tool-call") {
    const id = str(part.callID) || str(part.callId) || str(part.id) || "tool";
    const name = str(part.tool) || str(part.name) || "tool";
    const recState = asRecord(part.state);
    const state = str(recState?.status) || str(part.status) || str(recState?.type);
    const ended = state === "completed" || state === "error" || state === "failed" || state === "cancelled";
    const input = asRecord(part.input) ?? asRecord(recState?.input) ?? recState ?? part;
    const path = str(input?.path) || str(input?.file_path) || str(input?.filePath) || str(part.path);
    const command = str(input?.command) || str(part.command);
    const out: ServerMessage[] = [];
    if (!tools.has(id)) {
      tools.set(id, name);
      out.push({
        type: "tool.start",
        callId: id,
        kind: toolKindFromName(name),
        title: name,
        path,
        command,
      });
    }
    const output = str(recState?.output) || str(part.output);
    if (output && !ended) {
      const key = `tool:${id}`;
      const prev = snapshots.get(key) ?? "";
      if (output !== prev) {
        const delta = output.startsWith(prev) ? output.slice(prev.length) : output;
        snapshots.set(key, output);
        if (delta) out.push({ type: "tool.progress", callId: id, chunk: delta });
      }
    }
    if (ended) {
      const kind = toolKindFromName(tools.get(id) || name);
      const err =
        state === "error" || state === "failed" ? str(recState?.error) || "Tool failed" : undefined;
      const denied = toolDenied(state, err) || undefined;
      const { diff, stats, truncated } = extractDiff(part.state ?? part);
      out.push({
        type: "tool.end",
        callId: id,
        ok: !err && state !== "cancelled",
        kind,
        outputPreview: output?.slice(0, 4000),
        error: err,
        denied,
        diff,
        stats,
        truncated,
      });
    }
    return out;
  }
  return [];
}

export function opencodeSessionId(event: unknown): string | undefined {
  const rec = asRecord(event);
  if (!rec) return undefined;
  const props = asRecord(rec.properties) ?? rec;
  return str(rec.sessionID) || str(rec.sessionId) || str(props.sessionID) || str(props.sessionId);
}

/** Map an OpenCode SSE/SDK event to Glassys protocol events. */
export function mapOpencodeEvent(
  event: unknown,
  tools = new Map<string, string>(),
  snapshots = new Map<string, string>(),
  sessionId?: string,
): ServerMessage[] {
  if (sessionId) {
    const sid = opencodeSessionId(event);
    if (sid && sid !== sessionId) return [];
  }
  const rec = asRecord(event);
  if (!rec) return [];
  const type = str(rec.type) || "";
  const props = asRecord(rec.properties) ?? rec;
  if (type === "message.part.updated" || type === "session.next.text.delta" || type.endsWith("text.delta")) {
    const part = props.part ?? props;
    const text = str(asRecord(part)?.text) || str(props.delta) || str(props.text);
    const id = str(asRecord(part)?.id) || str(props.id) || type;
    if (text && (type.includes("reason") || asRecord(part)?.type === "reasoning")) {
      return snapshotDelta(snapshots, id, text, "thinking");
    }
    if (text) return snapshotDelta(snapshots, id, text, "text");
    return mapPart(part, tools, snapshots);
  }
  if (type.includes("reasoning")) {
    const text = str(props.delta) || str(props.text);
    return text ? snapshotDelta(snapshots, "reasoning", text, "thinking") : [];
  }
  if (type === "session.idle" || type === "session.idle.updated") return [];
  if (type === "session.error" || type === "error") {
    return [{ type: "run.error", message: str(props.message) || str(props.error) || "Run failed", phase: "run" }];
  }
  if (props.part) return mapPart(props.part, tools, snapshots);
  return [];
}

export function isOpencodeIdle(event: unknown): boolean {
  const rec = asRecord(event);
  const type = rec ? str(rec.type) : "";
  return type === "session.idle" || type === "session.idle.updated";
}

export function isOpencodeError(event: unknown): boolean {
  const rec = asRecord(event);
  const type = rec ? str(rec.type) : "";
  return type === "session.error" || type === "error";
}
