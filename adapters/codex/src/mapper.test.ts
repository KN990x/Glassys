import { describe, expect, it } from "vitest";
import { codexMapState, mapCodexJsonl, threadIdFromEvent } from "./mapper.js";

/* Event shapes as @openai/codex-sdk types them (ThreadEvent / ThreadItem). */
describe("mapCodexJsonl", () => {
  it("extracts thread id", () => {
    expect(threadIdFromEvent({ type: "thread.started", thread_id: "abc" })).toBe("abc");
  });

  it("streams assistant text and reasoning as deltas", () => {
    const state = codexMapState();
    expect(mapCodexJsonl({ type: "item.updated", item: { id: "i3", type: "agent_message", text: "Hel" } }, state)).toEqual([
      { type: "text.delta", text: "Hel" },
    ]);
    expect(mapCodexJsonl({ type: "item.completed", item: { id: "i3", type: "agent_message", text: "Hello" } }, state)).toEqual([
      { type: "text.delta", text: "lo" },
    ]);
    expect(mapCodexJsonl({ type: "item.completed", item: { id: "r1", type: "reasoning", text: "plan" } }, state)).toEqual([
      { type: "thinking.delta", text: "plan" },
    ]);
  });

  it("maps a command with streamed output and a failing exit code", () => {
    const state = codexMapState();
    const item = (status: string, aggregated_output: string, exit_code?: number) => ({
      id: "sh",
      type: "command_execution",
      command: "make",
      aggregated_output,
      status,
      ...(exit_code !== undefined ? { exit_code } : {}),
    });
    expect(mapCodexJsonl({ type: "item.started", item: item("in_progress", "") }, state)).toEqual([
      { type: "tool.start", callId: "sh", kind: "shell", title: "make", command: "make" },
    ]);
    expect(mapCodexJsonl({ type: "item.updated", item: item("in_progress", "cc a\n") }, state)).toEqual([
      { type: "tool.progress", callId: "sh", chunk: "cc a\n" },
    ]);
    const [end] = mapCodexJsonl({ type: "item.completed", item: item("failed", "cc a\nerror\n", 2) }, state);
    expect(end).toMatchObject({ type: "tool.end", ok: false, error: "exit 2", outputPreview: "cc a\nerror\n" });
  });

  it("maps a file_change (only ever emitted completed) with its paths", () => {
    const events = mapCodexJsonl({
      type: "item.completed",
      item: {
        id: "fc",
        type: "file_change",
        changes: [
          { path: "src/app.ts", kind: "update" },
          { path: "src/new.ts", kind: "add" },
        ],
        status: "completed",
      },
    });
    expect(events[0]).toMatchObject({ type: "tool.start", kind: "edit", title: "2 files" });
    expect(events[1]).toMatchObject({ type: "tool.end", ok: true, kind: "edit", outputPreview: "update src/app.ts\nadd src/new.ts" });
    const single = mapCodexJsonl({
      type: "item.completed",
      item: { id: "fc2", type: "file_change", changes: [{ path: "a.ts", kind: "update" }], status: "completed" },
    });
    expect(single[0]).toMatchObject({ title: "a.ts", path: "a.ts" });
  });

  it("names MCP calls by server and tool and reads their error object", () => {
    const state = codexMapState();
    const base = { id: "m", type: "mcp_tool_call", server: "github", tool: "search", arguments: {} };
    expect(mapCodexJsonl({ type: "item.started", item: { ...base, status: "in_progress" } }, state)[0]).toMatchObject({
      kind: "mcp",
      title: "github/search",
    });
    expect(
      mapCodexJsonl({ type: "item.completed", item: { ...base, status: "failed", error: { message: "rate limited" } } }, state)[0],
    ).toMatchObject({ ok: false, error: "rate limited" });
    expect(
      mapCodexJsonl(
        { type: "item.completed", item: { ...base, id: "m2", status: "completed", result: { content: [{ type: "text", text: "3 hits" }], structured_content: null } } },
        state,
      ),
    ).toEqual([expect.objectContaining({ type: "tool.start" }), expect.objectContaining({ type: "tool.end", outputPreview: "3 hits" })]);
  });

  it("maps turn.completed usage without double counting cached input", () => {
    expect(
      mapCodexJsonl({
        type: "turn.completed",
        usage: { input_tokens: 40, cached_input_tokens: 30, cache_write_input_tokens: 0, output_tokens: 9, reasoning_output_tokens: 2 },
      }),
    ).toEqual([{ type: "run.usage", inputTokens: 40, outputTokens: 9 }]);
  });

  it("maps failures", () => {
    expect(mapCodexJsonl({ type: "turn.failed", error: { message: "quota" } })).toEqual([
      { type: "run.error", message: "quota", phase: "run" },
    ]);
    expect(mapCodexJsonl({ type: "item.completed", item: { id: "e", type: "error", message: "bad" } })).toEqual([
      { type: "run.error", message: "bad", phase: "run" },
    ]);
  });
});
