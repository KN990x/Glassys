import { describe, expect, it } from "vitest";
import { mapCursorDelta, toolKindFromName, diffStats, unifiedFromWrite } from "./mapper.js";
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

  it("maps read/edit/shell tool lifecycle", () => {
    const start = mapCursorDelta({
      type: "tool-call-started",
      callId: "c1",
      toolCall: { name: "read", args: { path: "src/a.ts" } },
    });
    expect(start).toEqual([
      { type: "tool.start", callId: "c1", kind: "read", title: "src/a.ts", path: "src/a.ts", command: undefined },
    ]);

    const end = mapCursorDelta({
      type: "tool-call-completed",
      callId: "c1",
      toolCall: {
        name: "edit",
        path: "src/a.ts",
        result: { diffString: "--- a\n+++ b\n@@\n-old\n+new\n" },
      },
    });
    expect(end[0]).toMatchObject({
      type: "tool.end",
      callId: "c1",
      ok: true,
      kind: "edit",
      stats: { add: 1, del: 1 },
    });
  });

  it("maps shell output chunks and flattened nested task updates", () => {
    expect(
      mapCursorDelta({ type: "shell-output-delta", callId: "s1", event: { chunk: "npm test\n" } }),
    ).toEqual([{ type: "tool.progress", callId: "s1", chunk: "npm test\n" }]);

    const nested = mapCursorDelta({
      type: "tool-call-delta",
      callId: "task1",
      taskUpdate: { type: "text-delta", text: "child" },
    });
    expect(nested).toEqual([{ type: "text.delta", text: "child" }]);
  });

  it("flags truncated diffs and synthesizes unified diff for writes", () => {
    const truncated = mapCursorDelta({
      type: "tool-call-completed",
      callId: "e1",
      toolCall: { name: "edit", diffString: "+x", truncated: { result: true } },
    });
    expect(truncated[0]).toMatchObject({ truncated: true });

    const write = unifiedFromWrite("a.txt", "hello");
    expect(write).toContain("+++ b/a.txt");
    expect(diffStats(write)).toEqual({ add: 1, del: 0 });
  });

  it("maps tool names defensively", () => {
    expect(toolKindFromName("semSearch")).toBe("semsearch");
    expect(toolKindFromName("ApplyPatch")).toBe("edit");
    expect(toolKindFromName("mystery")).toBe("other");
  });

  it("maps a recorded onDelta fixture into protocol events", () => {
    const events = fixture.flatMap((delta) => mapCursorDelta(delta));
    expect(events.map((e) => e.type)).toEqual([
      "thinking.delta",
      "thinking.done",
      "tool.start",
      "tool.end",
      "text.delta",
    ]);
    expect(events[4]).toEqual({ type: "text.delta", text: "This repo is Glassys." });
    expect(events.some((e) => e.type === "run.done")).toBe(false);
  });

  it("ignores unknown updates and partial tool args", () => {
    expect(mapCursorDelta({ type: "token-delta", tokens: 3 })).toEqual([]);
    expect(mapCursorDelta({ type: "partial-tool-call", callId: "x", toolCall: {} })).toEqual([]);
  });
});
