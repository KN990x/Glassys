import { describe, expect, it } from "vitest";
import { coalesceTranscriptEvents, eventsToMarkdown } from "./transcript-export.js";
import type { ThreadMeta } from "./threads.js";

const meta: ThreadMeta = {
  id: "t1",
  title: "Ops box",
  adapter: "cursor",
  cwd: "/tmp/ops",
  model: "m",
  modelParams: [],
  options: {},
  agentId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("transcript export", () => {
  it("coalesces streamed thinking and text deltas", () => {
    const merged = coalesceTranscriptEvents([
      { type: "thinking.delta", text: "Hel" },
      { type: "thinking.delta", text: "lo" },
      { type: "text.delta", text: "Hi" },
      { type: "text.delta", text: " there" },
    ]);
    expect(merged).toEqual([
      { type: "thinking.delta", text: "Hello" },
      { type: "text.delta", text: "Hi there" },
    ]);
  });

  it("omits retracted operator messages and joins tokens in markdown", () => {
    const md = eventsToMarkdown(meta, [
      { type: "user.message", text: "keep", id: "a" },
      { type: "user.message", text: "drop me", id: "b" },
      { type: "user.retracted", id: "b" },
      { type: "thinking.delta", text: "Hel" },
      { type: "thinking.delta", text: "lo" },
      { type: "text.delta", text: "Hi" },
      { type: "text.delta", text: " there" },
    ]);
    expect(md).toContain("## Operator");
    expect(md).toContain("keep");
    expect(md).not.toContain("drop me");
    expect(md).toContain("Hello");
    expect(md).toContain("Hi there");
    expect(md).not.toMatch(/### Thinking[\s\S]*### Thinking/);
  });
});
