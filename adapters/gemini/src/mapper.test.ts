import { describe, expect, it } from "vitest";
import { mapGeminiChunk } from "./mapper.js";

describe("mapGeminiChunk", () => {
  it("maps content and thought chunks", () => {
    expect(mapGeminiChunk({ type: "content", value: { text: "Hi" } })).toEqual([{ type: "text.delta", text: "Hi" }]);
    expect(mapGeminiChunk({ type: "content", value: "Hi" })).toEqual([{ type: "text.delta", text: "Hi" }]);
    expect(mapGeminiChunk({ type: "thought", value: { text: "plan" } })).toEqual([{ type: "thinking.delta", text: "plan" }]);
    expect(mapGeminiChunk({ type: "thought", value: "plan" })).toEqual([{ type: "thinking.delta", text: "plan" }]);
  });

  it("maps tool calls", () => {
    const tools = new Map<string, string>();
    expect(mapGeminiChunk({ type: "tool_call", id: "t1", name: "read_file", status: "start" }, tools)[0]).toMatchObject({
      type: "tool.start",
      kind: "read",
    });
  });

  it("emits start and end when the first tool chunk is already completed", () => {
    const tools = new Map<string, string>();
    const events = mapGeminiChunk(
      { type: "tool_call", id: "t2", name: "write_file", status: "completed", value: { output: "ok" } },
      tools,
    );
    expect(events.map((e) => e.type)).toEqual(["tool.start", "tool.end"]);
  });

  it("pulls a unified diff from a completed tool chunk", () => {
    const tools = new Map<string, string>([["t3", "edit"]]);
    const diff = "--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n";
    const events = mapGeminiChunk(
      { type: "tool_call", id: "t3", name: "edit", status: "completed", value: { diffString: diff } },
      tools,
    );
    expect(events[0]).toMatchObject({ type: "tool.end", diff });
  });
});
