import { describe, expect, it } from "vitest";
import { parseJsonl } from "./jsonl.js";

describe("parseJsonl", () => {
  it("skips blank and corrupt lines", () => {
    const raw = [
      "",
      '{"type":"text.delta","text":"ok"}',
      "not-json",
      '{"type":"thinking.delta","text":"hi"}',
      " ",
    ].join("\n");
    expect(parseJsonl(raw)).toEqual([
      { type: "text.delta", text: "ok" },
      { type: "thinking.delta", text: "hi" },
    ]);
  });
});
