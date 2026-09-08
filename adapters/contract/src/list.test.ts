import { describe, expect, it } from "vitest";
import { extractListedModels } from "./list.js";

const longCatalog = [
  { id: "grok-4.6", displayName: "Grok 4.6" },
  { id: "composer-2.5", displayName: "Composer 2.5" },
  { id: "claude-opus-4.6", displayName: "Opus 4.6" },
  { id: "claude-sonnet-4.6", displayName: "Sonnet 4.6" },
  { id: "gpt-5.2", displayName: "GPT-5.2" },
  { id: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro" },
  { id: "auto", displayName: "Auto" },
  { id: "auto-smart", displayName: "Auto (Router)" },
];

describe("extractListedModels", () => {
  it("accepts a bare array", () => {
    expect(extractListedModels(longCatalog)).toHaveLength(8);
  });

  it("accepts { models }", () => {
    expect(extractListedModels({ models: longCatalog }).map((m) => (m as { id: string }).id)).toContain("gpt-5.2");
  });

  it("accepts { items }", () => {
    expect(extractListedModels({ items: longCatalog })).toHaveLength(8);
  });

  it("accepts { data }", () => {
    expect(extractListedModels({ data: longCatalog })).toHaveLength(8);
  });

  it("returns empty for unknown shapes", () => {
    expect(extractListedModels(null)).toEqual([]);
    expect(extractListedModels({ foo: 1 })).toEqual([]);
    expect(extractListedModels("grok-4.6")).toEqual([]);
  });
});
