import { describe, expect, it } from "vitest";
import { formatThinkingDuration } from "./Thinking";

describe("formatThinkingDuration", () => {
  it("does not invent 1s for a forced close", () => {
    expect(formatThinkingDuration(undefined)).toBe("…");
    expect(formatThinkingDuration(0)).toBe("…");
  });

  it("rounds real durations up to whole seconds", () => {
    expect(formatThinkingDuration(1200)).toBe("1s");
    expect(formatThinkingDuration(1600)).toBe("2s");
  });
});
