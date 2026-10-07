import { describe, expect, it } from "vitest";
import { usageFrom } from "./util.js";

describe("usageFrom", () => {
  it("adds cached prompt tokens to input across vendor casings", () => {
    expect(usageFrom({ input_tokens: 10, cache_read_input_tokens: 900, cache_creation_input_tokens: 50, output_tokens: 7 })).toEqual({
      inputTokens: 960,
      outputTokens: 7,
    });
    expect(usageFrom({ inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 })).toEqual({
      inputTokens: 8,
      outputTokens: 2,
    });
    expect(usageFrom({ promptTokens: 5 })).toEqual({ inputTokens: 5, outputTokens: undefined });
    /* OpenAI counts cached tokens inside input_tokens already. */
    expect(usageFrom({ input_tokens: 100, cached_input_tokens: 80, output_tokens: 1 })).toEqual({ inputTokens: 100, outputTokens: 1 });
  });

  it("is null when there is nothing to report", () => {
    expect(usageFrom(undefined)).toBeNull();
    expect(usageFrom({ unrelated: 1 })).toBeNull();
  });
});
