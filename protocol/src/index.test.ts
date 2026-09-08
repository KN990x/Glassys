import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  DEFAULT_KEEPALIVE_SECONDS,
  MAX_KEEPALIVE_SECONDS,
  MIN_KEEPALIVE_SECONDS,
  clampKeepaliveSeconds,
  clampStallSeconds,
  DEFAULT_STALL_SECONDS,
  defaultConfig,
  defaultPromptTemplates,
  normalizePromptTemplates,
  isClientMessage,
  isPersistedTranscriptEvent,
  isTranscriptEvent,
  resolveTheme,
} from "../src/index.js";

describe("protocol v1", () => {
  it("freezes major version 1", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it("defaults bind to localhost", () => {
    expect(defaultConfig().network.bind).toBe("127.0.0.1");
    expect(defaultConfig().agent.adapter).toBe("cursor");
    expect(defaultConfig().agent.model).toBe("");
    expect(defaultConfig().agent.options).toEqual({});
    expect(defaultConfig().session.stallSeconds).toBe(DEFAULT_STALL_SECONDS);
    expect(defaultConfig().session.notifyOnComplete).toBe(true);
    expect(defaultConfig().prompts.templates.map((t) => t.slash)).toEqual(
      defaultPromptTemplates().map((t) => t.slash),
    );
    expect(clampStallSeconds(-1)).toBe(DEFAULT_STALL_SECONDS);
    expect(clampStallSeconds(0)).toBe(0);
    expect(clampStallSeconds(99999)).toBe(3600);
    expect(normalizePromptTemplates([{ slash: "/Status", title: "S", text: " ping " }])).toEqual([
      { id: "status", slash: "status", title: "S", text: "ping" },
    ]);
    expect(normalizePromptTemplates([])).toEqual([]);
  });

  it("accepts known client envelopes with required fields", () => {
    expect(isClientMessage({ type: "hello", protocolVersion: 1 })).toBe(true);
    expect(isClientMessage({ type: "hello" })).toBe(false);
    expect(isClientMessage({ type: "auth", token: "" })).toBe(true);
    expect(isClientMessage({ type: "auth" })).toBe(false);
    expect(isClientMessage({ type: "user.message", text: "hi" })).toBe(true);
    expect(isClientMessage({ type: "user.message" })).toBe(false);
    expect(isClientMessage({ type: "config.set", patch: {} })).toBe(true);
    expect(isClientMessage({ type: "config.set" })).toBe(false);
    expect(isClientMessage({ type: "ping" })).toBe(true);
    expect(isClientMessage({ type: "queue.cancel", id: "q1" })).toBe(true);
    expect(isClientMessage({ type: "queue.cancel" })).toBe(false);
    expect(isClientMessage({ type: "thread.new" })).toBe(true);
    expect(isClientMessage({ type: "thread.switch", id: "t1" })).toBe(true);
    expect(isClientMessage({ type: "thread.switch" })).toBe(false);
    expect(isClientMessage({ type: "nope" })).toBe(false);
  });

  it("clamps WebSocket keepalive to 15–30 seconds", () => {
    expect(clampKeepaliveSeconds(DEFAULT_KEEPALIVE_SECONDS)).toBe(25);
    expect(clampKeepaliveSeconds(5)).toBe(MIN_KEEPALIVE_SECONDS);
    expect(clampKeepaliveSeconds(120)).toBe(MAX_KEEPALIVE_SECONDS);
    expect(clampKeepaliveSeconds(Number.NaN)).toBe(DEFAULT_KEEPALIVE_SECONDS);
  });

  it("does not persist ephemeral run lifecycle events", () => {
    expect(isTranscriptEvent({ type: "run.queued" })).toBe(true);
    expect(isPersistedTranscriptEvent({ type: "run.queued" })).toBe(false);
    expect(isPersistedTranscriptEvent({ type: "run.start", runId: "1" })).toBe(false);
    expect(isPersistedTranscriptEvent({ type: "run.done" })).toBe(true);
    expect(isPersistedTranscriptEvent({ type: "user.message", text: "x" })).toBe(true);
    expect(isPersistedTranscriptEvent({ type: "user.retracted", id: "m1" })).toBe(true);
    expect(isPersistedTranscriptEvent({ type: "run.usage", inputTokens: 1 })).toBe(true);
    expect(isPersistedTranscriptEvent({ type: "run.stalled", idleMs: 180000 })).toBe(true);
    expect(isPersistedTranscriptEvent({ type: "tool.progress", callId: "c1", chunk: "x" })).toBe(false);
    expect(isTranscriptEvent({ type: "queue.snapshot", items: [] } as never)).toBe(false);
    expect(isTranscriptEvent({ type: "threads.snapshot", threads: [], currentId: null } as never)).toBe(false);
  });

  it("treats missing available as selectable and ok:false as not", async () => {
    const { adapterSelectable } = await import("../src/index.js");
    expect(
      adapterSelectable({
        id: "cursor",
        displayName: "Cursor",
        capabilities: {
          models: true,
          sandbox: false,
          settingSources: false,
          autoRun: false,
          cancel: true,
          resume: true,
          discover: false,
          toolConfirmation: "none",
          auth: { kind: "api-key", envNames: [] },
        },
        auth: { loggedIn: false, apiKeyConfigured: false },
      }),
    ).toBe(true);
    expect(
      adapterSelectable({
        id: "gemini",
        displayName: "Gemini",
        capabilities: {
          models: true,
          sandbox: false,
          settingSources: false,
          autoRun: false,
          cancel: true,
          resume: false,
          discover: false,
          toolConfirmation: "none",
          auth: { kind: "api-key", envNames: [] },
        },
        available: { ok: false, error: "SDK missing" },
        auth: { loggedIn: false, apiKeyConfigured: false },
      }),
    ).toBe(false);
  });

  it("accepts UUID user.message ids", async () => {
    const { isMessageId } = await import("../src/index.js");
    expect(isMessageId("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(isMessageId("not-a-uuid")).toBe(false);
    expect(isMessageId(undefined)).toBe(false);
  });

  it("resolves system theme from prefers-color-scheme", () => {
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
    expect(resolveTheme("system", true)).toBe("light");
    expect(resolveTheme("system", false)).toBe("dark");
  });

  it("keeps schema v1 client consts aligned with isClientMessage", () => {
    const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "../schema/v1.json");
    const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as {
      oneOf: Array<{ properties?: { type?: { const?: string } } }>;
    };
    const consts = schema.oneOf.map((item) => item.properties?.type?.const).filter((v): v is string => Boolean(v));
    const samples: Record<string, unknown> = {
      hello: { type: "hello", protocolVersion: 1 },
      auth: { type: "auth", token: "" },
      "user.message": { type: "user.message", text: "hi" },
      "run.cancel": { type: "run.cancel" },
      "queue.cancel": { type: "queue.cancel", id: "q1" },
      "thread.new": { type: "thread.new" },
      "thread.switch": { type: "thread.switch", id: "t1" },
      "config.get": { type: "config.get" },
      "config.set": { type: "config.set", patch: {} },
      ping: { type: "ping" },
    };
    for (const [type, sample] of Object.entries(samples)) {
      expect(consts).toContain(type);
      expect(isClientMessage(sample)).toBe(true);
    }
  });
});
