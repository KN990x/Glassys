import { describe, expect, it } from "vitest";
import { acpResumeUnsupported, acpShouldLoadSession } from "./index.js";

describe("acpShouldLoadSession", () => {
  it("is false unless the agent advertises loadSession: true", () => {
    expect(acpShouldLoadSession(undefined)).toBe(false);
    expect(acpShouldLoadSession({})).toBe(false);
    expect(acpShouldLoadSession({ loadSession: false })).toBe(false);
    expect(acpShouldLoadSession({ session: { loadSession: true } })).toBe(true);
    expect(acpShouldLoadSession({ loadSession: true })).toBe(true);
  });
});

describe("acpResumeUnsupported", () => {
  it("is true when a resume id exists but the agent cannot resume or load", () => {
    expect(acpResumeUnsupported("s1", undefined)).toBe(true);
    expect(acpResumeUnsupported("s1", { session: { resume: true } })).toBe(false);
    expect(acpResumeUnsupported("s1", { loadSession: true })).toBe(false);
    expect(acpResumeUnsupported(undefined, {})).toBe(false);
  });
});

describe("acp adapter capabilities", () => {
  it("does not advertise resume until the child agent is known to support it", async () => {
    const { acpAdapter, acpChildSupportsResume } = await import("./index.js");
    expect(acpAdapter.capabilities.resume).toBe(false);
    expect(acpChildSupportsResume(undefined)).toBe(false);
    expect(acpChildSupportsResume({ session: { loadSession: true } })).toBe(true);
    await expect(acpAdapter.probe?.()).resolves.toBeUndefined();
    await expect(acpAdapter.probe?.({})).rejects.toThrow(/command/);
  });
});

/* A minimal spec-shaped ACP agent: NDJSON, silent until spoken to, auth required on session/new. */
const FAKE_AGENT = `
const rl = require("readline").createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\\n");
let authed = false;
let pending = null;
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") return send({ id: msg.id, result: { protocolVersion: 1, authMethods: [{ id: "token", name: "Token" }] } });
  if (msg.method === "authenticate") { authed = msg.params.methodId === "token"; return send({ id: msg.id, result: {} }); }
  if (msg.method === "session/new") {
    if (!authed) return send({ id: msg.id, error: { code: -32000, message: "Authentication required" } });
    return send({ id: msg.id, result: { sessionId: "s-1" } });
  }
  if (msg.method === "session/set_model") return send({ id: msg.id, result: {} });
  if (msg.method === "session/prompt") {
    const text = msg.params.prompt[0].text;
    send({ method: "session/update", params: { sessionId: "s-1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "echo:" + text } } } });
    if (text === "hang") { pending = msg.id; return; }
    return send({ id: msg.id, result: { stopReason: "end_turn", usage: { inputTokens: 3, outputTokens: 2 } } });
  }
  if (msg.method === "session/cancel" && pending !== null) { send({ id: pending, result: { stopReason: "cancelled" } }); pending = null; }
});
`;

describe("acp adapter against a spec-shaped agent", () => {
  it("authenticates only when asked, streams, and cancels", async () => {
    const { acpAdapter } = await import("./index.js");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const cwd = await mkdtemp(join(tmpdir(), "glassys-acp-e2e-"));
    const session = await acpAdapter.create({
      cwd,
      model: "default",
      modelParams: [],
      storeDir: join(cwd, ".store"),
      options: { command: process.execPath, args: ["-e", FAKE_AGENT], autoRun: true },
    });
    try {
      const events: Array<{ type: string }> = [];
      const run = await session.send("hi", (e) => events.push(e));
      await expect(run.wait()).resolves.toBe("finished");
      expect(events).toEqual([
        { type: "text.delta", text: "echo:hi" },
        { type: "run.usage", inputTokens: 3, outputTokens: 2 },
      ]);
      const hung = await session.send("hang", () => undefined);
      await new Promise((r) => setTimeout(r, 50));
      await hung.cancel();
      await expect(hung.wait()).resolves.toBe("cancelled");
    } finally {
      await session.dispose();
    }
  }, 15_000);
});
