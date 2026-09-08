import { describe, expect, it } from "vitest";
import { mapAcpUpdate } from "./mapper.js";

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
    const tools = new Map<string, string>();
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

  it("maps a unified diff on tool_call_update when present", () => {
    const tools = new Map<string, string>([["t1", "edit"]]);
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
    const tools = new Map<string, string>([["t1", "edit"]]);
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
});
