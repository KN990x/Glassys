import { describe, expect, it } from "vitest";
import {
  isOpencodeError,
  isOpencodeIdle,
  isStaleOpencodeIdle,
  mapOpencodeEvent,
  opencodeMapState,
  opencodePermission,
  opencodeSessionId,
} from "./mapper.js";

/* Event shapes as @opencode-ai/sdk types them (types.gen.d.ts). */
const part = (p: Record<string, unknown>, delta?: string) => ({
  type: "message.part.updated",
  properties: { part: { sessionID: "ses_1", messageID: "msg_a", ...p }, ...(delta ? { delta } : {}) },
});
const tool = (callID: string, toolName: string, state: Record<string, unknown>) =>
  part({ id: `prt_${callID}`, type: "tool", callID, tool: toolName, state });

describe("mapOpencodeEvent", () => {
  it("maps text and reasoning, preferring the event's delta", () => {
    const state = opencodeMapState();
    expect(mapOpencodeEvent(part({ id: "p1", type: "text", text: "Hel" }, "Hel"), state)).toEqual([
      { type: "text.delta", text: "Hel" },
    ]);
    expect(mapOpencodeEvent(part({ id: "p1", type: "text", text: "Hello" }, "lo"), state)).toEqual([
      { type: "text.delta", text: "lo" },
    ]);
    expect(mapOpencodeEvent(part({ id: "p2", type: "reasoning", text: "plan" }), state)).toEqual([
      { type: "thinking.delta", text: "plan" },
    ]);
    /* Without a delta, a growing snapshot still yields only the new suffix. */
    expect(mapOpencodeEvent(part({ id: "p2", type: "reasoning", text: "plan more" }), state)).toEqual([
      { type: "thinking.delta", text: " more" },
    ]);
  });

  it("does not echo the operator's own prompt or synthetic parts", () => {
    const state = opencodeMapState();
    mapOpencodeEvent({ type: "message.updated", properties: { info: { id: "msg_u", sessionID: "ses_1", role: "user" } } }, state);
    expect(mapOpencodeEvent(part({ id: "pu", messageID: "msg_u", type: "text", text: "hi" }), state)).toEqual([]);
    expect(mapOpencodeEvent(part({ id: "ps", type: "text", text: "x", synthetic: true }), state)).toEqual([]);
  });

  it("refines a pending tool once its input arrives, streams output, and ends with a diff", () => {
    const state = opencodeMapState();
    expect(mapOpencodeEvent(tool("c1", "edit", { status: "pending", input: {}, raw: "" }), state)).toEqual([
      expect.objectContaining({ type: "tool.start", callId: "c1", kind: "edit", path: undefined }),
    ]);
    expect(
      mapOpencodeEvent(tool("c1", "edit", { status: "running", input: { filePath: "/w/a.ts" }, time: { start: 1 } }), state),
    ).toEqual([expect.objectContaining({ type: "tool.start", callId: "c1", path: "/w/a.ts" })]);
    const diff = "--- a/w/a.ts\n+++ b/w/a.ts\n@@ -1 +1 @@\n-a\n+b";
    const end = mapOpencodeEvent(
      tool("c1", "edit", {
        status: "completed",
        input: { filePath: "/w/a.ts" },
        output: "",
        title: "a.ts",
        metadata: { diff },
        time: { start: 1, end: 2 },
      }),
      state,
    );
    expect(end).toEqual([expect.objectContaining({ type: "tool.end", ok: true, diff, stats: { add: 1, del: 1 } })]);
  });

  it("shows only new shell output while running and reports errors", () => {
    const state = opencodeMapState();
    mapOpencodeEvent(tool("c2", "bash", { status: "running", input: { command: "make" }, time: { start: 1 } }), state);
    const run = (output: string) =>
      mapOpencodeEvent(tool("c2", "bash", { status: "running", input: { command: "make" }, metadata: { output }, time: { start: 1 } }), state);
    expect(run("cc a.c\n")).toEqual([{ type: "tool.progress", callId: "c2", chunk: "cc a.c\n" }]);
    expect(run("cc a.c\ncc b.c\n")).toEqual([{ type: "tool.progress", callId: "c2", chunk: "cc b.c\n" }]);
    const end = mapOpencodeEvent(
      tool("c2", "bash", { status: "error", input: { command: "make" }, error: "make: *** [all] Error 2", time: { start: 1, end: 2 } }),
      state,
    );
    expect(end).toEqual([expect.objectContaining({ type: "tool.end", ok: false, error: "make: *** [all] Error 2", denied: undefined })]);
  });

  it("emits start and end when the first tool event is already completed", () => {
    const events = mapOpencodeEvent(
      tool("c3", "read", { status: "completed", input: { filePath: "/w/b" }, output: "body", title: "b", metadata: {}, time: { start: 1, end: 2 } }),
    );
    expect(events.map((e) => e.type)).toEqual(["tool.start", "tool.end"]);
    expect(events[1]).toMatchObject({ outputPreview: "body" });
  });

  it("marks a refused permission as denied", () => {
    const [, end] = mapOpencodeEvent(
      tool("c4", "bash", {
        status: "error",
        input: { command: "rm -rf x" },
        error: "The user rejected permission to use this specific tool call.",
        time: { start: 1, end: 2 },
      }),
    );
    expect(end).toMatchObject({ type: "tool.end", denied: true });
  });

  it("reports usage once per finished assistant message, cache included", () => {
    const state = opencodeMapState();
    const info = {
      id: "msg_a",
      sessionID: "ses_1",
      role: "assistant",
      time: { created: 1, completed: 2 },
      tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 100, write: 3 } },
    };
    expect(mapOpencodeEvent({ type: "message.updated", properties: { info } }, state)).toEqual([
      { type: "run.usage", inputTokens: 113, outputTokens: 5 },
    ]);
    expect(mapOpencodeEvent({ type: "message.updated", properties: { info } }, state)).toEqual([]);
  });

  it("reads error messages from data.message and ignores the operator's abort", () => {
    expect(
      mapOpencodeEvent({
        type: "session.error",
        properties: { sessionID: "ses_1", error: { name: "APIError", data: { message: "model not found", isRetryable: false } } },
      }),
    ).toEqual([{ type: "run.error", message: "model not found", phase: "run" }]);
    const aborted = { type: "session.error", properties: { sessionID: "ses_1", error: { name: "MessageAbortedError", data: { message: "x" } } } };
    expect(mapOpencodeEvent(aborted)).toEqual([]);
    expect(isOpencodeError(aborted)).toBe(false);
  });

  it("finds the session id where the SDK puts it and drops other sessions", () => {
    expect(opencodeSessionId(part({ type: "text", text: "x" }))).toBe("ses_1");
    expect(opencodeSessionId({ type: "message.updated", properties: { info: { sessionID: "ses_2" } } })).toBe("ses_2");
    expect(opencodeSessionId({ type: "session.idle", properties: { sessionID: "ses_3" } })).toBe("ses_3");
    expect(mapOpencodeEvent(part({ id: "p", type: "text", text: "theirs" }), opencodeMapState(), "ses_other")).toEqual([]);
  });

  it("recognizes permission requests and idleness", () => {
    expect(
      opencodePermission({ type: "permission.updated", properties: { id: "per_1", sessionID: "ses_1", title: "bash", callID: "c" } }),
    ).toEqual({ id: "per_1", title: "bash", callId: "c" });
    expect(isOpencodeIdle({ type: "session.idle", properties: { sessionID: "s" } })).toBe(true);
    expect(isOpencodeIdle({ type: "session.status", properties: { sessionID: "s", status: { type: "idle" } } })).toBe(true);
    expect(isStaleOpencodeIdle({ type: "session.idle" }, false, false)).toBe(true);
    expect(isStaleOpencodeIdle({ type: "session.idle" }, true, false)).toBe(false);
    expect(isStaleOpencodeIdle({ type: "session.idle" }, false, true)).toBe(false);
  });
});
