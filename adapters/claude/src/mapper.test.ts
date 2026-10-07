import { describe, expect, it } from "vitest";
import { claudeMapState, claudeRunStatus, claudeSessionId, mapClaudeMessage } from "./mapper.js";

const stream = (event: Record<string, unknown>) => ({ type: "stream_event", event });

describe("mapClaudeMessage", () => {
  it("maps text and thinking stream deltas", () => {
    expect(mapClaudeMessage(stream({ type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } }))).toEqual([
      { type: "text.delta", text: "Hi" },
    ]);
    expect(
      mapClaudeMessage(stream({ type: "content_block_delta", delta: { type: "thinking_delta", thinking: "plan" } })),
    ).toEqual([{ type: "thinking.delta", text: "plan" }]);
  });

  it("closes thinking on content_block_stop", () => {
    const state = claudeMapState();
    state.thinkingStarted = Date.now() - 50;
    expect(mapClaudeMessage(stream({ type: "content_block_stop", index: 0 }), state)[0]).toMatchObject({ type: "thinking.done" });
    expect(state.thinkingStarted).toBeUndefined();
  });

  it("fills in a tool's path and command from the complete assistant message", () => {
    const state = claudeMapState();
    /* The stream announces the call with empty input; the arguments stream in afterwards. */
    expect(
      mapClaudeMessage(stream({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t1", name: "Bash", input: {} } }), state),
    ).toEqual([{ type: "tool.start", callId: "t1", kind: "shell", title: "Bash", path: undefined, command: undefined }]);
    const refined = mapClaudeMessage(
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Checking." },
            { type: "tool_use", id: "t1", name: "Bash", input: { command: "systemctl status caddy" } },
          ],
        },
      },
      state,
    );
    expect(refined).toEqual([expect.objectContaining({ type: "tool.start", callId: "t1", command: "systemctl status caddy" })]);
  });

  it("ends tools with their text output and flags errors", () => {
    const state = claudeMapState();
    state.tools.set("t1", "Read");
    state.tools.set("t2", "Bash");
    const ends = mapClaudeMessage(
      {
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "line 1" }] },
            { type: "tool_result", tool_use_id: "t2", is_error: true, content: "Exit code 1\nboom" },
          ],
        },
      },
      state,
    );
    expect(ends[0]).toMatchObject({ type: "tool.end", callId: "t1", ok: true, kind: "read", outputPreview: "line 1" });
    expect(ends[1]).toMatchObject({ type: "tool.end", callId: "t2", ok: false, error: "Exit code 1\nboom", denied: undefined });
  });

  it("marks a policy denial as denied, from the system message or the tool_result text", () => {
    const state = claudeMapState();
    mapClaudeMessage({ type: "system", subtype: "permission_denied", tool_name: "Bash", tool_use_id: "t3" }, state);
    const [byEvent] = mapClaudeMessage(
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t3", is_error: true, content: "Not run" }] } },
      state,
    );
    expect(byEvent).toMatchObject({ denied: true });
    const [byText] = mapClaudeMessage(
      {
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "t4", is_error: true, content: "Glassys denied access to its own data directory (secrets, sessions)" },
          ],
        },
      },
      state,
    );
    expect(byText).toMatchObject({ denied: true });
  });

  it("builds an edit diff from Claude Code's structured tool result", () => {
    const state = claudeMapState();
    state.tools.set("t1", "Edit");
    const [end] = mapClaudeMessage(
      {
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "The file a.ts has been updated." }] },
        tool_use_result: {
          filePath: "/w/a.ts",
          oldString: "old",
          newString: "new",
          structuredPatch: [{ oldStart: 3, oldLines: 3, newStart: 3, newLines: 3, lines: [" a", "-old", "+new", " b"] }],
        },
      },
      state,
    );
    expect(end).toMatchObject({ type: "tool.end", ok: true, kind: "edit", stats: { add: 1, del: 1 } });
    expect(end && "diff" in end ? end.diff : "").toContain("@@ -3,3 +3,3 @@");
  });

  it("shows a created file as a new-file diff", () => {
    const state = claudeMapState();
    state.tools.set("t1", "Write");
    const [end] = mapClaudeMessage(
      {
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "File created" }] },
        tool_use_result: { type: "create", filePath: "/w/n.txt", content: "a\nb\n", structuredPatch: [] },
      },
      state,
    );
    expect(end).toMatchObject({ stats: { add: 2, del: 0 } });
  });

  it("reports usage with cached tokens and real error subtypes", () => {
    expect(
      mapClaudeMessage({
        type: "result",
        subtype: "success",
        usage: { input_tokens: 3, cache_read_input_tokens: 4000, cache_creation_input_tokens: 10, output_tokens: 7 },
      }),
    ).toEqual([{ type: "run.usage", inputTokens: 4013, outputTokens: 7 }]);
    expect(
      mapClaudeMessage({ type: "result", subtype: "error_during_execution", is_error: true, errors: ["API Error: 529 overloaded"] }),
    ).toEqual([{ type: "run.error", message: "API Error: 529 overloaded", phase: "run" }]);
    expect(mapClaudeMessage({ type: "result", subtype: "error_max_turns", is_error: true, errors: [] })[0]).toMatchObject({
      message: "Claude hit its turn limit",
    });
  });

  it("does not replay assistant text once stream events painted it", () => {
    const state = claudeMapState();
    state.sawStreamEvent = true;
    expect(mapClaudeMessage({ type: "assistant", message: { content: [{ type: "text", text: "Hi" }] } }, state)).toEqual([]);
  });

  it("paints assistant text when no stream_event was seen", () => {
    expect(mapClaudeMessage({ type: "assistant", message: { content: [{ type: "text", text: "Hi" }] } })).toEqual([
      { type: "text.delta", text: "Hi" },
    ]);
  });

  it("reads session_id from system/init payloads", () => {
    expect(claudeSessionId({ type: "system", subtype: "init", session_id: "ses_1" })).toBe("ses_1");
  });

  it("treats an interrupt that still emits result as cancelled", () => {
    expect(claudeRunStatus(true, { type: "result", subtype: "success" })).toBe("cancelled");
    expect(claudeRunStatus(false, { type: "result", subtype: "error_during_execution", is_error: true })).toBe("error");
    expect(claudeRunStatus(false, { type: "result", subtype: "success" })).toBe("finished");
  });
});
