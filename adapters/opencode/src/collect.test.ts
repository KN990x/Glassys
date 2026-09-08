import { describe, expect, it } from "vitest";
import { collectModels } from "./index.js";

describe("collectModels", () => {
  it("reads a providers array", () => {
    const models = collectModels({
      providers: [
        {
          id: "opencode",
          models: { "gpt-5": { name: "GPT-5" } },
        },
      ],
    });
    expect(models).toEqual([{ id: "opencode/gpt-5", displayName: "GPT-5" }]);
  });

  it("unwraps { data } and a provider map", () => {
    const models = collectModels({
      data: {
        provider: {
          anthropic: { models: { "claude-sonnet": { name: "Sonnet" } } },
        },
      },
    });
    expect(models).toEqual([{ id: "anthropic/claude-sonnet", displayName: "Sonnet" }]);
  });

  it("returns empty when nothing is configured", () => {
    expect(collectModels({})).toEqual([]);
    expect(collectModels({ provider: {} })).toEqual([]);
  });
});
