import { describe, expect, it } from "vitest";
import { CLAUDE_STATIC_CATALOG, claudeCatalogFromListed } from "./index.js";

describe("claude catalog", () => {
  it("labels an empty live list as fallback", () => {
    const listed = claudeCatalogFromListed([]);
    expect(listed.source).toBe("fallback");
    expect(listed.error).toMatch(/empty/);
    expect(listed.models).toEqual(CLAUDE_STATIC_CATALOG);
  });

  it("labels a non-empty list as live and merges static metadata", () => {
    const listed = claudeCatalogFromListed([{ id: "sonnet", displayName: "Sonnet live" }]);
    expect(listed.source).toBe("live");
    expect(listed.models.some((m) => m.id === "sonnet")).toBe(true);
  });
});
