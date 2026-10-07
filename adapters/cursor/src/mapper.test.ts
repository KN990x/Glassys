import { describe, expect, it } from "vitest";
import { cursorMapState, mapCursorDelta, toolKindFromName } from "./mapper.js";
import fixture from "./fixtures/deltas.json";

describe("mapCursorDelta", () => {
  it("maps text and thinking tokens without waiting for result", () => {
    expect(mapCursorDelta({ type: "text-delta", text: "Hi" })).toEqual([{ type: "text.delta", text: "Hi" }]);
    expect(mapCursorDelta({ type: "thinking-delta", text: "plan" })).toEqual([
      { type: "thinking.delta", text: "plan" },
    ]);
    expect(mapCursorDelta({ type: "thinking-completed", thinkingDurationMs: 1200 })).toEqual([
      { type: "thinking.done", durationMs: 1200 },
    ]);
  });

  it("maps an SDK-shaped session: read, failing shell with streamed output, edit with diff", () => {
    const state = cursorMapState();
    const events = fixture.flatMap((delta) => mapCursorDelta(delta, state));
    expect(events.map((e) => e.type)).toEqual([
      "thinking.delta",
      "thinking.done",
      "tool.start",
      "tool.end",
      "tool.start",
      "tool.progress",
      "tool.end",
      "tool.start",
      "tool.end",
      "text.delta",
    ]);
    expect(events[3]).toMatchObject({ type: "tool.end", ok: true, kind: "read", outputPreview: "# hi" });
    expect(events[4]).toMatchObject({ type: "tool.start", kind: "shell", title: "false", command: "false" });
    expect(events[5]).toEqual({ type: "tool.progress", callId: "2", chunk: "boom\n" });
    expect(events[6]).toMatchObject({ type: "tool.end", ok: false, error: "exit 1", outputPreview: "boom\n" });
    expect(events[7]).toMatchObject({ type: "tool.start", kind: "edit", path: "src/a.ts" });
    expect(events[8]).toMatchObject({ type: "tool.end", ok: true, kind: "edit", stats: { add: 1, del: 1 } });
    expect(events.some((e) => e.type === "run.done")).toBe(false);
  });

  it("synthesizes a new-file diff for writes", () => {
    const [end] = mapCursorDelta({
      type: "tool-call-completed",
      callId: "w1",
      toolCall: {
        type: "write",
        args: { path: "a.txt", fileText: "hello\nworld" },
        result: { status: "success", value: { path: "a.txt", linesCreated: 2, fileSize: 11 } },
      },
    });
    expect(end).toMatchObject({ ok: true, kind: "write", stats: { add: 2, del: 0 } });
    expect(end && "diff" in end ? end.diff : "").toContain("--- /dev/null");
  });

  it("reports an error result with its message, and auto-review refusals as denied", () => {
    const [failed] = mapCursorDelta({
      type: "tool-call-completed",
      callId: "e1",
      toolCall: { type: "edit", args: { path: "a" }, result: { status: "error", error: { message: "no such file" } } },
    });
    expect(failed).toMatchObject({ ok: false, error: "no such file", denied: undefined });
    const [denied] = mapCursorDelta({
      type: "tool-call-completed",
      callId: "e2",
      toolCall: { type: "shell", args: { command: "rm -rf /" }, result: { status: "error", error: "Denied by auto-review" } },
    });
    expect(denied).toMatchObject({ ok: false, denied: true });
  });

  it("names MCP calls by provider and tool and shows their text output", () => {
    const state = cursorMapState();
    const call = { type: "mcp", args: { providerIdentifier: "github", toolName: "search_issues", args: {} } };
    expect(mapCursorDelta({ type: "tool-call-started", callId: "m1", toolCall: call }, state)[0]).toMatchObject({
      kind: "mcp",
      title: "github/search_issues",
    });
    const [end] = mapCursorDelta(
      {
        type: "tool-call-completed",
        callId: "m1",
        toolCall: { ...call, result: { status: "success", value: { content: [{ text: { text: "3 issues" } }] } } },
      },
      state,
    );
    expect(end).toMatchObject({ ok: true, outputPreview: "3 issues" });
  });

  it("flattens nested task updates and ignores output with no running shell", () => {
    expect(mapCursorDelta({ type: "tool-call-delta", callId: "task1", taskUpdate: { type: "text-delta", text: "child" } })).toEqual([
      { type: "text.delta", text: "child" },
    ]);
    expect(mapCursorDelta({ type: "shell-output-delta", event: { case: "stdout", value: { data: "x" } } })).toEqual([]);
  });

  it("maps tool names defensively", () => {
    expect(toolKindFromName("semSearch")).toBe("semsearch");
    expect(toolKindFromName("ApplyPatch")).toBe("edit");
    expect(toolKindFromName("mystery")).toBe("other");
  });

  it("ignores unknown updates and partial tool args", () => {
    expect(mapCursorDelta({ type: "token-delta", tokens: 3 })).toEqual([]);
    expect(mapCursorDelta({ type: "partial-tool-call", callId: "x", toolCall: {} })).toEqual([]);
  });
});
