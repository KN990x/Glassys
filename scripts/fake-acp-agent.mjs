#!/usr/bin/env node
/**
 * A spec-shaped ACP agent with no model behind it, for trying the PWA and testing the gateway
 * without a vendor account. It speaks NDJSON JSON-RPC on stdio and drives the host the way
 * real agents do: file writes and terminals go through Glassys, a shell asks permission first.
 *
 *   Wizard or Settings → ACP → command `node`, arguments `scripts/fake-acp-agent.mjs`
 *   (an absolute path when the workspace is elsewhere).
 *
 * Prompts: `long [seconds]` streams ticks until cancelled (default 150 s, past the proxies'
 * ~100 s idle cut); anything else runs the demo turn: thinking, write and edit demo.txt, a
 * failing `sh` through a host terminal, a read, and a markdown reply.
 */
import { join } from "node:path";
import { createInterface } from "node:readline";

const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MODELS = [
  { modelId: "fake-fast", name: "Fake fast", description: "Answers at once" },
  { modelId: "fake-deep", name: "Fake deep", description: "Thinks a little longer" },
];

let nextId = 1;
const waiting = new Map();
/** A request to the client (Glassys); resolves with its result. */
const call = (method, params) =>
  new Promise((resolve, reject) => {
    const id = `fake-${nextId++}`;
    waiting.set(id, { resolve, reject });
    send({ id, method, params });
  });

let cwd = process.cwd();
let sessionId = "";
let model = MODELS[0].modelId;
let turn = null;

const update = (u) => send({ method: "session/update", params: { sessionId, update: u } });
const textOf = (text) => [{ type: "content", content: { type: "text", text } }];

async function stream(kind, text, ms, t) {
  for (const piece of text.match(/\S+\s*|\s+/g) ?? []) {
    if (t.cancelled) return;
    update({ sessionUpdate: kind, content: { type: "text", text: piece } });
    await sleep(ms);
  }
}

async function write(id, title, file, before, after) {
  update({ sessionUpdate: "tool_call", toolCallId: id, title, kind: "edit", status: "pending", locations: [{ path: file }] });
  try {
    await call("fs/write_text_file", { sessionId, path: file, content: after });
    update({ sessionUpdate: "tool_call_update", toolCallId: id, status: "completed", content: [{ type: "diff", path: file, oldText: before, newText: after }] });
  } catch (err) {
    update({ sessionUpdate: "tool_call_update", toolCallId: id, status: "failed", content: textOf(err.message) });
  }
}

async function shell(id, t) {
  const command = "sh -c 'echo checking; false'";
  const toolCall = { toolCallId: id, title: command, kind: "execute", status: "pending", rawInput: { command } };
  update({ sessionUpdate: "tool_call", ...toolCall });
  const answer = await call("session/request_permission", {
    sessionId,
    toolCall,
    options: [
      { optionId: "yes", name: "Allow", kind: "allow_once" },
      { optionId: "no", name: "Reject", kind: "reject_once" },
    ],
  });
  if (answer.outcome?.outcome !== "selected" || answer.outcome.optionId !== "yes") {
    update({ sessionUpdate: "tool_call_update", toolCallId: id, status: "failed", content: textOf("User refused permission to run tool") });
    return;
  }
  try {
    const { terminalId } = await call("terminal/create", { sessionId, command: "sh", args: ["-c", "echo checking; sleep 0.2; false"], outputByteLimit: 4096 });
    update({ sessionUpdate: "tool_call_update", toolCallId: id, status: "in_progress", content: [{ type: "terminal", terminalId }] });
    const exit = await call("terminal/wait_for_exit", { sessionId, terminalId });
    await call("terminal/release", { sessionId, terminalId });
    if (t.cancelled) return;
    update({
      sessionUpdate: "tool_call_update",
      toolCallId: id,
      status: exit.exitCode === 0 ? "completed" : "failed",
      content: [{ type: "terminal", terminalId }],
      rawOutput: { exitCode: exit.exitCode },
    });
  } catch (err) {
    update({ sessionUpdate: "tool_call_update", toolCallId: id, status: "failed", content: textOf(err.message) });
  }
}

async function demo(t, prompt) {
  const images = prompt.filter((p) => p.type === "image").length;
  await stream("agent_thought_chunk", `Checking the host tools with ${model}: write, edit, a failing command, a read.`, 15, t);
  const file = join(cwd, "demo.txt");
  if (!t.cancelled) await write("w1", "Write demo.txt", file, null, "hello\n");
  if (!t.cancelled) await write("e1", "Edit demo.txt", file, "hello\n", "hello world\n");
  if (!t.cancelled) await shell("x1", t);
  if (t.cancelled) return;
  try {
    const { content } = await call("fs/read_text_file", { sessionId, path: file });
    update({ sessionUpdate: "tool_call", toolCallId: "r1", title: "Read demo.txt", kind: "read", status: "completed", locations: [{ path: file }], content: textOf(content) });
  } catch (err) {
    update({ sessionUpdate: "tool_call", toolCallId: "r1", title: "Read demo.txt", kind: "read", status: "failed", locations: [{ path: file }], content: textOf(err.message) });
  }
  const reply =
    `Done${images ? ` (${images} image${images > 1 ? "s" : ""} received)` : ""}.\n\n` +
    "- `demo.txt` was **written**, then *edited*.\n" +
    "- The shell step exits non-zero on purpose.\n\n" +
    "```sh\ncat demo.txt\n```\n";
  await stream("agent_message_chunk", reply, 10, t);
}

async function long(t, seconds) {
  const end = Date.now() + seconds * 1000;
  for (let n = 1; !t.cancelled && Date.now() < end; n++) {
    update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: `tick ${n} ` } });
    await sleep(200);
  }
}

async function prompt(msg) {
  const t = { cancelled: false };
  turn = t;
  const blocks = msg.params?.prompt ?? [];
  const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join(" ");
  const asked = /\blong(?:\s+(\d+))?/.exec(text);
  try {
    if (asked) await long(t, Number(asked[1] ?? 150));
    else await demo(t, blocks);
  } catch (err) {
    process.stderr.write(`fake-acp-agent: ${err.message}\n`);
  }
  turn = null;
  send({ id: msg.id, result: { stopReason: t.cancelled ? "cancelled" : "end_turn", usage: { inputTokens: 1200, outputTokens: 340, totalTokens: 1540 } } });
}

createInterface({ input: process.stdin }).on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id !== undefined && !msg.method) {
    const pending = waiting.get(msg.id);
    waiting.delete(msg.id);
    if (pending) msg.error ? pending.reject(new Error(msg.error.message)) : pending.resolve(msg.result);
    return;
  }
  const params = msg.params ?? {};
  switch (msg.method) {
    case "initialize":
      return send({ id: msg.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: false, promptCapabilities: { image: true } }, authMethods: [] } });
    case "session/new":
      cwd = params.cwd || cwd;
      sessionId = `fake-${Date.now()}`;
      return send({ id: msg.id, result: { sessionId, models: { currentModelId: model, availableModels: MODELS } } });
    case "session/set_model":
      model = params.modelId || model;
      return send({ id: msg.id, result: {} });
    case "session/prompt":
      return void prompt(msg);
    case "session/cancel":
      if (turn) turn.cancelled = true;
      return;
    default:
      if (msg.id !== undefined) send({ id: msg.id, error: { code: -32601, message: "Method not found" } });
  }
});
