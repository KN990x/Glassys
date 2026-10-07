import type { ServerMessage } from "@glassys/protocol";
import { asRecord, extractDiff, num, str, toolDenied, toolKindFromName } from "@glassys/adapter-contract";

/*
 * Shapes, from @opencode-ai/sdk's types.gen: parts carry `sessionID` and `messageID`; a tool part
 * is `{ callID, tool, state }` with state `pending | running | completed | error`; a message's
 * role, error and token counts arrive on `message.updated` as `properties.info`.
 */

/** Per-run mapping state. */
export type OpencodeMapState = {
  /** Tool calls seen, with whether their path/command has been shown yet. */
  tools: Map<string, { name: string; located: boolean }>;
  /** Last full text of each text/reasoning part, to turn snapshots into deltas. */
  snapshots: Map<string, string>;
  /** Shown output of each running tool. */
  output: Map<string, string>;
  /** Role of each message id, so the operator's own prompt is not echoed as agent text. */
  roles: Map<string, string>;
  /** Assistant messages whose usage was already reported. */
  billed: Set<string>;
};

export function opencodeMapState(): OpencodeMapState {
  return { tools: new Map(), snapshots: new Map(), output: new Map(), roles: new Map(), billed: new Set() };
}

const PREVIEW_CHARS = 4000;

function textDelta(
  state: OpencodeMapState,
  id: string,
  text: string,
  delta: string | undefined,
  kind: "text" | "thinking",
): ServerMessage[] {
  const prev = state.snapshots.get(id) ?? "";
  state.snapshots.set(id, text);
  /* Prefer the event's own delta; only diff snapshots when it has none. */
  const next = delta ?? (text.startsWith(prev) ? text.slice(prev.length) : "");
  if (!next) return [];
  return [{ type: kind === "thinking" ? "thinking.delta" : "text.delta", text: next }];
}

/** OpenCode puts edit diffs in the tool state's metadata. */
function toolDiff(toolState: Record<string, unknown>) {
  const metadata = asRecord(toolState.metadata);
  const found = extractDiff(metadata ?? {});
  return found.diff ? found : extractDiff(toolState);
}

function mapToolPart(part: Record<string, unknown>, state: OpencodeMapState): ServerMessage[] {
  const id = str(part.callID) || str(part.id) || "tool";
  const name = str(part.tool) || "tool";
  const toolState = asRecord(part.state) ?? {};
  const status = str(toolState.status);
  const input = asRecord(toolState.input) ?? {};
  const path = str(input.filePath) || str(input.path) || str(input.file_path);
  const command = str(input.command);
  const out: ServerMessage[] = [];
  const seen = state.tools.get(id);
  /* The first event is often `pending` with empty input; refine the card once the input arrives. */
  if (!seen || (!seen.located && (path || command))) {
    state.tools.set(id, { name, located: Boolean(path || command) });
    out.push({
      type: "tool.start",
      callId: id,
      kind: toolKindFromName(name),
      title: str(toolState.title) || command || path || name,
      path,
      command,
    });
  }
  const output = str(toolState.output) ?? str(asRecord(toolState.metadata)?.output);
  if (status === "running" && output) {
    const prev = state.output.get(id) ?? "";
    state.output.set(id, output);
    if (output.startsWith(prev) && output.length > prev.length) {
      out.push({ type: "tool.progress", callId: id, chunk: output.slice(prev.length) });
    }
  }
  if (status === "completed" || status === "error") {
    state.output.delete(id);
    const err = status === "error" ? str(toolState.error) || "Tool failed" : undefined;
    const { diff, stats, truncated } = toolDiff(toolState);
    out.push({
      type: "tool.end",
      callId: id,
      ok: !err,
      kind: toolKindFromName(name),
      outputPreview: output?.slice(0, PREVIEW_CHARS),
      error: err,
      denied: toolDenied(undefined, err) || undefined,
      diff,
      stats,
      truncated,
    });
  }
  return out;
}

function mapPart(part: Record<string, unknown>, delta: string | undefined, state: OpencodeMapState): ServerMessage[] {
  const messageId = str(part.messageID);
  if (messageId && state.roles.get(messageId) === "user") return [];
  const type = str(part.type) || "";
  if (type === "text") {
    if (part.synthetic === true || part.ignored === true) return [];
    return textDelta(state, str(part.id) || "text", typeof part.text === "string" ? part.text : "", delta, "text");
  }
  if (type === "reasoning") {
    return textDelta(state, str(part.id) || "reasoning", typeof part.text === "string" ? part.text : "", delta, "thinking");
  }
  if (type === "tool") return mapToolPart(part, state);
  return [];
}

/** An OpenCode error object (`{ name, data: { message } }`) in the operator's words. */
export function opencodeErrorMessage(error: unknown): string | undefined {
  const rec = asRecord(error);
  if (!rec) return str(error);
  return str(asRecord(rec.data)?.message) ?? str(rec.message) ?? str(rec.name);
}

/** The operator's own cancel ends the message with this; it is not a failure. */
function isAbort(error: unknown): boolean {
  return asRecord(error)?.name === "MessageAbortedError";
}

function mapMessageInfo(info: Record<string, unknown>, state: OpencodeMapState): ServerMessage[] {
  const id = str(info.id);
  const role = str(info.role);
  if (id && role) state.roles.set(id, role);
  if (role !== "assistant" || !id) return [];
  const out: ServerMessage[] = [];
  if (info.error && !isAbort(info.error)) {
    out.push({ type: "run.error", message: opencodeErrorMessage(info.error) || "Run failed", phase: "run" });
  }
  const completed = num(asRecord(info.time)?.completed);
  const tokens = asRecord(info.tokens);
  if (completed && tokens && !state.billed.has(id)) {
    state.billed.add(id);
    const cache = asRecord(tokens.cache) ?? {};
    const input = (num(tokens.input) ?? 0) + (num(cache.read) ?? 0) + (num(cache.write) ?? 0);
    const output = num(tokens.output);
    if (input || output) out.push({ type: "run.usage", inputTokens: input || undefined, outputTokens: output });
  }
  return out;
}

export function opencodeSessionId(event: unknown): string | undefined {
  const rec = asRecord(event);
  if (!rec) return undefined;
  const props = asRecord(rec.properties) ?? rec;
  return (
    str(asRecord(props.part)?.sessionID) ||
    str(asRecord(props.info)?.sessionID) ||
    str(props.sessionID) ||
    str(rec.sessionID)
  );
}

/** Map an OpenCode SSE/SDK event to Glassys protocol events. */
export function mapOpencodeEvent(
  event: unknown,
  state: OpencodeMapState = opencodeMapState(),
  sessionId?: string,
): ServerMessage[] {
  if (sessionId) {
    const sid = opencodeSessionId(event);
    if (sid && sid !== sessionId) return [];
  }
  const rec = asRecord(event);
  if (!rec) return [];
  const type = str(rec.type) || "";
  const props = asRecord(rec.properties) ?? {};
  if (type === "message.updated") {
    const info = asRecord(props.info);
    return info ? mapMessageInfo(info, state) : [];
  }
  if (type === "message.part.updated") {
    const part = asRecord(props.part);
    return part ? mapPart(part, str(props.delta), state) : [];
  }
  if (type === "session.error") {
    if (isAbort(props.error)) return [];
    return [{ type: "run.error", message: opencodeErrorMessage(props.error) || "Run failed", phase: "run" }];
  }
  return [];
}

export function isOpencodeIdle(event: unknown): boolean {
  const rec = asRecord(event);
  const type = rec ? str(rec.type) : "";
  if (type === "session.idle") return true;
  /* Newer servers report idleness as a status change. */
  return type === "session.status" && asRecord(asRecord(rec?.properties)?.status)?.type === "idle";
}

/** Leftover idle from a previous prompt must not end the next send. */
export function isStaleOpencodeIdle(event: unknown, sawRunEvent: boolean, promptSettled: boolean): boolean {
  return isOpencodeIdle(event) && !sawRunEvent && !promptSettled;
}

export function isOpencodeError(event: unknown): boolean {
  const rec = asRecord(event);
  if (rec?.type !== "session.error") return false;
  return !isAbort(asRecord(rec.properties)?.error);
}

/** A permission request: OpenCode's "ask" policy, waiting for an answer nobody is there to give. */
export function opencodePermission(event: unknown): { id: string; title?: string; callId?: string } | null {
  const rec = asRecord(event);
  if (rec?.type !== "permission.updated") return null;
  const props = asRecord(rec.properties) ?? {};
  const id = str(props.id);
  return id ? { id, title: str(props.title), callId: str(props.callID) } : null;
}
