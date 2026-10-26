import type { ServerMessage } from "@glassys/protocol";
import { asRecord, extractDiff, num, str, toolDenied, toolKindFromName, PREVIEW_CHARS } from "@glassys/adapter-contract";
import { HOST_DENIAL_MARK, type HostLedger } from "./host.js";


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

/** A tool call's content as text, whole: the preview cuts it, progress needs all of it. */
function contentText(content: unknown, ledger?: HostLedger): string | undefined {
  if (typeof content === "string" && content) return content;
  if (!Array.isArray(content)) {
    const rec = asRecord(content);
    if (rec && typeof rec.text === "string") return rec.text || undefined;
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
    /* An embedded terminal carries only its id; the host ran it and kept the output. */
    if (rec.type === "terminal" && typeof rec.terminalId === "string") {
      const out = ledger?.output.get(rec.terminalId);
      if (out) parts.push(out);
      continue;
    }
    if (typeof rec.text === "string") parts.push(rec.text);
    const nested = asRecord(rec.content);
    if (nested && typeof nested.text === "string") parts.push(nested.text);
  }
  return parts.join("") || undefined;
}

/**
 * Per-turn mapping state: each call's tool name, how much of its output was already shown, and
 * the host's ledger of refused calls and terminal output.
 */
export type AcpMapState = { tools: Map<string, string>; shown: Map<string, Shown>; ledger?: HostLedger };

/** How far a call's output was shown: its length then, and its last characters to find the spot again. */
type Shown = { length: number; tail: string };
const TAIL_MARK = 64;

export function acpMapState(ledger?: HostLedger): AcpMapState {
  return { tools: new Map(), shown: new Map(), ledger };
}

/** `rawOutput` is free-form: a string, or a record with the output and maybe an exit code. */
function rawOutputText(raw: unknown): string | undefined {
  if (typeof raw === "string") return raw || undefined;
  const rec = asRecord(raw);
  if (!rec) return undefined;
  return [str(rec.output), str(rec.stdout), str(rec.stderr)].filter(Boolean).join("\n") || undefined;
}

function outputText(update: Record<string, unknown>, state: AcpMapState): string | undefined {
  return contentText(update.content, state.ledger) || rawOutputText(update.rawOutput) || str(update.output);
}

function preview(update: Record<string, unknown>, state: AcpMapState): string | undefined {
  return outputText(update, state)?.slice(0, PREVIEW_CHARS);
}

function toolEnd(id: string, status: string, update: Record<string, unknown>, state: AcpMapState): ServerMessage {
  const { diff, stats, truncated } = extractDiff(update);
  const failed = status === "failed" || status === "cancelled";
  const output = preview(update, state);
  const exitCode = num(asRecord(update.rawOutput)?.exitCode) ?? num(asRecord(update.rawOutput)?.exit_code);
  /* The card already says it failed; a bare "failed" under it says nothing more. */
  const err = failed ? str(update.error) || (exitCode ? `exit ${exitCode}` : status === "cancelled" ? status : undefined) : undefined;
  const refused = state.ledger?.denied.delete(id) === true || (failed && Boolean(output?.includes(HOST_DENIAL_MARK)));
  return {
    type: "tool.end",
    callId: id,
    ok: status === "completed",
    kind: toolKindFromName(state.tools.get(id)),
    outputPreview: output,
    error: err,
    denied: (failed && refused) || toolDenied(status, err) || undefined,
    diff,
    stats,
    truncated,
  };
}

/**
 * ACP sends a tool call's content whole on every update. Show only what is new since the last
 * one. The text either grew (most calls) or slid (a terminal past its byte limit keeps only its
 * tail): the end of what was shown, found again, marks where the new part starts. Content that was
 * rewritten has nothing appendable to show.
 */
function progress(id: string, update: Record<string, unknown>, state: AcpMapState): ServerMessage[] {
  const full = outputText(update, state);
  if (!full) return [];
  const before = state.shown.get(id);
  state.shown.set(id, { length: full.length, tail: full.slice(-TAIL_MARK) });
  let from = 0;
  if (before) {
    if (full.length >= before.length && full.slice(before.length - before.tail.length, before.length) === before.tail) {
      from = before.length;
    } else {
      const at = full.lastIndexOf(before.tail);
      if (at < 0) return [];
      from = at + before.tail.length;
    }
  }
  if (from >= full.length) return [];
  return [{ type: "tool.progress", callId: id, chunk: full.slice(from) }];
}

function toolStart(id: string, update: Record<string, unknown>, state: AcpMapState): ServerMessage {
  const kindName = str(update.kind) || str(update.toolName) || str(update.title) || state.tools.get(id) || "tool";
  state.tools.set(id, kindName);
  const loc = Array.isArray(update.locations) ? asRecord(update.locations[0]) : asRecord(update.locations);
  const raw = asRecord(update.rawInput);
  return {
    type: "tool.start",
    callId: id,
    kind: toolKindFromName(kindName),
    title: str(update.title) || str(update.toolName) || str(update.kind) || "tool",
    path: str(update.path) || str(loc?.path) || str(raw?.path) || str(raw?.file_path),
    command: str(update.command) || str(raw?.command),
  };
}

const DONE = new Set(["completed", "failed", "cancelled"]);

export function mapAcpUpdate(params: unknown, state: AcpMapState = acpMapState()): ServerMessage[] {
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
  const id = str(update.toolCallId) || str(update.toolCallID) || "tool";
  const status = str(update.status);
  if (sessionUpdate === "tool_call") {
    const start = toolStart(id, update, state);
    /* A call can arrive already finished (a fast read); it still needs its end. */
    return status && DONE.has(status) ? [start, toolEnd(id, status, update, state)] : [start];
  }
  if (sessionUpdate === "tool_call_update") {
    if (status && DONE.has(status)) {
      state.shown.delete(id);
      return [toolEnd(id, status, update, state)];
    }
    const out: ServerMessage[] = [];
    /* Updates without a status refine the call: a better title, its location, its input. */
    if (!status && (str(update.title) || str(update.kind) || update.locations || update.rawInput)) {
      out.push(toolStart(id, update, state));
    }
    out.push(...progress(id, update, state));
    return out;
  }
  return [];
}
