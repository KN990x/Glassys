import { describe, expect, it } from "vitest";
import { claudeRunStatus, claudeSessionId, mapClaudeMessage } from "./mapper.js";

describe("mapClaudeMessage", () => {
  it("maps text and thinking stream deltas", () => {
    expect(
      mapClaudeMessage({
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } },
      }),
    ).toEqual([{ type: "text.delta", text: "Hi" }]);
    expect(
      mapClaudeMessage({
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "plan" } },
      }),
    ).toEqual([{ type: "thinking.delta", text: "plan" }]);
  });

  it("closes thinking on content_block_stop", () => {
    const state = { sawStreamEvent: false, thinkingStarted: Date.now() - 50 };
    expect(
      mapClaudeMessage({ type: "stream_event", event: { type: "content_block_stop" } }, new Map(), state)[0],
    ).toMatchObject({ type: "thinking.done" });
    expect(state.thinkingStarted).toBeUndefined();
  });

  it("maps tool_use start/end", () => {
    const tools = new Map<string, string>();
    const start = mapClaudeMessage(
      {
        type: "stream_event",
        event: {
          type: "content_block_start",
          content_block: { type: "tool_use", id: "t1", name: "Read", input: { file_path: "a.ts" } },
        },
      },
      tools,
    );
    expect(start[0]).toMatchObject({ type: "tool.start", callId: "t1", kind: "read", path: "a.ts" });
    const bash = mapClaudeMessage(
      {
        type: "stream_event",
        event: {
          type: "content_block_start",
          content_block: { type: "tool_use", id: "t-bash", name: "Bash", input: { command: "systemctl status caddy" } },
        },
      },
      tools,
    );
    expect(bash[0]).toMatchObject({ type: "tool.start", kind: "shell", command: "systemctl status caddy" });
    const end = mapClaudeMessage(
      {
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
      },
      tools,
    );
    expect(end[0]).toMatchObject({ type: "tool.end", callId: "t1", ok: true, kind: "read" });
  });

  it("maps tool_progress when the SDK emits it", () => {
    expect(
      mapClaudeMessage({
        type: "tool_progress",
        tool_use_id: "t1",
        content: "bytes",
      }),
    ).toEqual([{ type: "tool.progress", callId: "t1", chunk: "bytes" }]);
  });

  it("maps result.usage", () => {
    expect(
      mapClaudeMessage({ type: "result", usage: { input_tokens: 3, output_tokens: 7 } }),
    ).toEqual([{ type: "run.usage", inputTokens: 3, outputTokens: 7 }]);
  });

  it("maps a unified diff on tool_result when the SDK provided one", () => {
    const tools = new Map<string, string>([["t1", "Edit"]]);
    const diff = "--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n";
    const end = mapClaudeMessage(
      {
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "t1", diffString: diff }] },
      },
      tools,
    );
    expect(end[0]).toMatchObject({ type: "tool.end", diff, stats: { add: 1, del: 1 } });
  });

  it("does not replay assistant snapshots (stream_event already painted the text)", () => {
    expect(
      mapClaudeMessage({
        type: "assistant",
        message: { content: [{ type: "text", text: "Hi" }] },
      }),
    ).toEqual([]);
    expect(
      mapClaudeMessage(
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "Hi" }] },
        },
        new Map(),
        { sawStreamEvent: true },
      ),
    ).toEqual([]);
  });

  it("paints assistant text when no stream_event was seen", () => {
    expect(
      mapClaudeMessage(
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "Hi" }] },
        },
        new Map(),
        { sawStreamEvent: false },
      ),
    ).toEqual([{ type: "text.delta", text: "Hi" }]);
  });

  it("reads session_id from system/init payloads", () => {
    expect(claudeSessionId({ type: "system", subtype: "init", session_id: "ses_1" })).toBe("ses_1");
  });

  it("treats an interrupt that still emits result as cancelled", () => {
    expect(claudeRunStatus(true, { type: "result", subtype: "success" })).toBe("cancelled");
    expect(claudeRunStatus(false, { type: "result", subtype: "error" })).toBe("error");
    expect(claudeRunStatus(false, { type: "result" })).toBe("finished");
  });
});
