import { describe, expect, it } from "vitest";
import { mapCodexJsonl, threadIdFromEvent } from "./mapper.js";

describe("mapCodexJsonl", () => {
  it("extracts thread id", () => {
    expect(threadIdFromEvent({ type: "thread.started", thread_id: "abc" })).toBe("abc");
  });

  it("maps command execution and assistant text", () => {
    const tools = new Map<string, string>();
    expect(
      mapCodexJsonl({ type: "item.started", item: { id: "i1", type: "command_execution", command: "ls" } }, tools)[0],
    ).toMatchObject({ type: "tool.start", kind: "shell" });
    expect(mapCodexJsonl({ type: "item.completed", item: { id: "i2", type: "agent_message", text: "done" } })).toEqual([
      { type: "text.delta", text: "done" },
    ]);
    const snap = new Map<string, string>();
    expect(
      mapCodexJsonl({ type: "item.updated", item: { id: "i3", type: "agent_message", text: "Hel" } }, new Map(), snap),
    ).toEqual([{ type: "text.delta", text: "Hel" }]);
    expect(
      mapCodexJsonl({ type: "item.completed", item: { id: "i3", type: "agent_message", text: "Hello" } }, new Map(), snap),
    ).toEqual([{ type: "text.delta", text: "lo" }]);
  });

  it("uses the file path on file_change, not the item id", () => {
    const ev = mapCodexJsonl({
      type: "item.started",
      item: { id: "item-9", type: "file_change", path: "src/app.ts" },
    })[0];
    expect(ev).toMatchObject({ type: "tool.start", path: "src/app.ts" });
  });

  it("maps file_change diffs when present", () => {
    const diff = "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-a\n+b\n";
    const end = mapCodexJsonl({
      type: "item.completed",
      item: { id: "item-9", type: "file_change", path: "src/app.ts", diff },
    })[0];
    expect(end).toMatchObject({ type: "tool.end", diff, stats: { add: 1, del: 1 } });
  });
});
