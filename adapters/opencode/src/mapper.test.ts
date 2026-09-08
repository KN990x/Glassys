import { describe, expect, it } from "vitest";
import { isOpencodeError, isOpencodeIdle, isStaleOpencodeIdle, mapOpencodeEvent, opencodeSessionId } from "./mapper.js";

describe("mapOpencodeEvent", () => {
  it("maps text and reasoning deltas", () => {
    expect(
      mapOpencodeEvent({ type: "message.part.updated", properties: { part: { type: "text", text: "Hi" } } }),
    ).toEqual([{ type: "text.delta", text: "Hi" }]);
    expect(
      mapOpencodeEvent({ type: "message.part.updated", properties: { part: { type: "reasoning", text: "plan" } } }),
    ).toEqual([{ type: "thinking.delta", text: "plan" }]);
  });

  it("maps tool lifecycle from part state", () => {
    const tools = new Map<string, string>();
    const start = mapOpencodeEvent(
      { type: "message.part.updated", properties: { part: { type: "tool", callID: "c1", tool: "bash", state: { status: "running" } } } },
      tools,
    );
    expect(start[0]).toMatchObject({ type: "tool.start", callId: "c1", kind: "shell" });
    const withLoc = mapOpencodeEvent(
      {
        type: "message.part.updated",
        properties: {
          part: {
            type: "tool",
            callID: "c-loc",
            tool: "bash",
            state: { status: "running", input: { command: "ls /etc" } },
          },
        },
      },
      tools,
    );
    expect(withLoc[0]).toMatchObject({ type: "tool.start", command: "ls /etc" });
    const denied = mapOpencodeEvent(
      {
        type: "message.part.updated",
        properties: { part: { type: "tool", callID: "c-deny", tool: "write", state: { status: "cancelled" } } },
      },
      tools,
    );
    expect(denied.some((e) => e.type === "tool.end" && "denied" in e && e.denied)).toBe(true);
    const end = mapOpencodeEvent(
      { type: "message.part.updated", properties: { part: { type: "tool", callID: "c1", tool: "bash", state: { status: "completed", output: "ok" } } } },
      tools,
    );
    expect(end[0]).toMatchObject({ type: "tool.end", callId: "c1", ok: true });
    const again = mapOpencodeEvent(
      { type: "message.part.updated", properties: { part: { type: "tool", callID: "c1", tool: "bash", state: { status: "running" } } } },
      tools,
    );
    expect(again.filter((e) => e.type === "tool.start")).toEqual([]);
  });

  it("emits start and end when the first tool event is already completed", () => {
    const tools = new Map<string, string>();
    const events = mapOpencodeEvent(
      {
        type: "message.part.updated",
        properties: { part: { type: "tool", callID: "c2", tool: "bash", state: { status: "completed", output: "ok" } } },
      },
      tools,
    );
    expect(events.map((e) => e.type)).toEqual(["tool.start", "tool.end"]);
    expect(events[1]).toMatchObject({ type: "tool.end", callId: "c2", ok: true });
  });

  it("ignores events from another session", () => {
    expect(
      opencodeSessionId({ type: "message.part.updated", properties: { sessionID: "s1", part: { type: "text", text: "x" } } }),
    ).toBe("s1");
    expect(
      mapOpencodeEvent(
        {
          type: "message.part.updated",
          properties: { sessionID: "other", part: { type: "text", text: "nope" } },
        },
        new Map(),
        new Map(),
        "mine",
      ),
    ).toEqual([]);
  });

  it("maps a patch on a completed tool part", () => {
    const tools = new Map<string, string>([["c1", "edit"]]);
    const diff = "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n";
    const end = mapOpencodeEvent(
      {
        type: "message.part.updated",
        properties: { part: { type: "tool", callID: "c1", tool: "edit", state: { status: "completed", patch: diff } } },
      },
      tools,
    );
    expect(end[0]).toMatchObject({ type: "tool.end", diff });
  });

  it("emits suffixes when part text is a growing snapshot", () => {
    const snap = new Map<string, string>();
    expect(
      mapOpencodeEvent(
        { type: "message.part.updated", properties: { part: { id: "p1", type: "text", text: "Hel" } } },
        new Map(),
        snap,
      ),
    ).toEqual([{ type: "text.delta", text: "Hel" }]);
    expect(
      mapOpencodeEvent(
        { type: "message.part.updated", properties: { part: { id: "p1", type: "text", text: "Hello" } } },
        new Map(),
        snap,
      ),
    ).toEqual([{ type: "text.delta", text: "lo" }]);
  });

  it("maps session.usage when the runtime provides tokens", () => {
    expect(
      mapOpencodeEvent({
        type: "session.usage",
        properties: { tokens: { input: 11, output: 7 } },
      }),
    ).toEqual([{ type: "run.usage", inputTokens: 11, outputTokens: 7 }]);
  });

  it("treats leftover session.idle as stale until the current prompt has events", () => {
    expect(isStaleOpencodeIdle({ type: "session.idle" }, false, false)).toBe(true);
    expect(isStaleOpencodeIdle({ type: "session.idle" }, true, false)).toBe(false);
    expect(isStaleOpencodeIdle({ type: "session.idle" }, false, true)).toBe(false);
    expect(isOpencodeIdle({ type: "session.idle.updated" })).toBe(true);
    expect(isOpencodeError({ type: "session.error" })).toBe(true);
  });
});
