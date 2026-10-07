import { describe, expect, it } from "vitest";
import { acpMapState, mapAcpUpdate } from "./mapper.js";

describe("mapAcpUpdate", () => {
  it("maps message and thought chunks", () => {
    expect(
      mapAcpUpdate({ update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hi" } } }),
    ).toEqual([{ type: "text.delta", text: "Hi" }]);
    expect(
      mapAcpUpdate({ update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "plan" } } }),
    ).toEqual([{ type: "thinking.delta", text: "plan" }]);
  });

  it("maps tool calls", () => {
    const tools = acpMapState();
    expect(mapAcpUpdate({ update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "Read" } }, tools)[0]).toMatchObject({
      type: "tool.start",
      kind: "read",
    });
    expect(
      mapAcpUpdate(
        {
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "t1",
            status: "completed",
            content: [{ type: "content", text: "file body" }],
          },
        },
        tools,
      )[0],
    ).toMatchObject({ type: "tool.end", ok: true, outputPreview: "file body" });
  });

  it("classifies kind from update.kind, not a prose title", () => {
    const start = mapAcpUpdate({
      update: { sessionUpdate: "tool_call", toolCallId: "t2", kind: "read", title: "Reading package.json" },
    })[0];
    expect(start).toMatchObject({ type: "tool.start", kind: "read", title: "Reading package.json" });
  });

  it("maps in-progress tool updates as tool.progress", () => {
    expect(
      mapAcpUpdate({
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "t1",
          status: "in_progress",
          content: [{ type: "content", text: "out" }],
        },
      }),
    ).toEqual([{ type: "tool.progress", callId: "t1", chunk: "out" }]);
  });

  it("maps a cancelled tool update as denied only when a policy refused it", () => {
    const tools = acpMapState();
    tools.tools.set("t3", "write");
    expect(
      mapAcpUpdate({ update: { sessionUpdate: "tool_call_update", toolCallId: "t3", status: "cancelled" } }, tools)[0],
    ).toMatchObject({ type: "tool.end", ok: false, denied: undefined });
    expect(
      mapAcpUpdate(
        { update: { sessionUpdate: "tool_call_update", toolCallId: "t3", status: "cancelled", error: "Glassys denied" } },
        tools,
      )[0],
    ).toMatchObject({ type: "tool.end", ok: false, denied: true });
  });

  it("maps a unified diff on tool_call_update when present", () => {
    const tools = acpMapState();
    tools.tools.set("t1", "edit");
    const diff = "--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n+b\n";
    expect(
      mapAcpUpdate(
        {
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "t1",
            status: "completed",
            diff,
          },
        },
        tools,
      )[0],
    ).toMatchObject({ type: "tool.end", diff });
  });

  it("maps a spec content diff on tool_call_update", () => {
    const tools = acpMapState();
    tools.tools.set("t1", "edit");
    const end = mapAcpUpdate(
      {
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "t1",
          status: "completed",
          content: [{ type: "diff", path: "src/a.ts", oldText: "a", newText: "b" }],
        },
      },
      tools,
    )[0];
    expect(end).toMatchObject({ type: "tool.end", ok: true });
    expect(end && "diff" in end ? end.diff : "").toContain("--- a/src/a.ts");
  });

  it("ends a tool call that arrives already completed", () => {
    const events = mapAcpUpdate({
      update: { sessionUpdate: "tool_call", toolCallId: "t9", kind: "read", title: "Read a", status: "completed" },
    });
    expect(events.map((e) => e.type)).toEqual(["tool.start", "tool.end"]);
  });

  it("shows only new output when updates resend the whole content", () => {
    const state = acpMapState();
    const update = (text: string) =>
      mapAcpUpdate(
        { update: { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "in_progress", content: [{ type: "content", content: { type: "text", text } }] } },
        state,
      );
    expect(update("one\n")).toEqual([{ type: "tool.progress", callId: "t1", chunk: "one\n" }]);
    expect(update("one\ntwo\n")).toEqual([{ type: "tool.progress", callId: "t1", chunk: "two\n" }]);
    expect(update("one\ntwo\n")).toEqual([]);
  });

  it("refines a call from an update without status", () => {
    const events = mapAcpUpdate({
      update: { sessionUpdate: "tool_call_update", toolCallId: "t1", title: "Edit a.ts", kind: "edit", locations: [{ path: "/w/a.ts" }] },
    });
    expect(events).toEqual([expect.objectContaining({ type: "tool.start", kind: "edit", path: "/w/a.ts" })]);
  });
});
