import { describe, expect, it } from "vitest";
import { defaultParamsFor, matchingVariant, mergeModelCatalog, pickDefaultSelection } from "./models.js";
import type { ModelCatalogItem } from "./models.js";

const grok: ModelCatalogItem = {
  id: "grok-4.6",
  displayName: "Grok 4.6",
  parameters: [
    {
      id: "effort",
      values: [
        { value: "low" },
        { value: "high" },
        { value: "xhigh", displayName: "Extra high" },
      ],
    },
  ],
  variants: [
    { displayName: "Extra high", params: [{ id: "effort", value: "xhigh" }] },
    { displayName: "High", params: [{ id: "effort", value: "high" }], isDefault: true },
  ],
};

const composer: ModelCatalogItem = { id: "composer-2.5", displayName: "Composer 2.5" };

describe("model helpers", () => {
  it("picks a preferred id when present", () => {
    const sel = pickDefaultSelection([composer, grok], "grok-4.6");
    expect(sel.id).toBe("grok-4.6");
    expect(sel.params).toEqual([{ id: "effort", value: "high" }]);
  });

  it("falls back to the first listed model", () => {
    const sel = pickDefaultSelection([composer, grok]);
    expect(sel.id).toBe("composer-2.5");
    expect(sel.params).toEqual([]);
  });

  it("returns empty selection when the catalog is empty", () => {
    expect(pickDefaultSelection([])).toEqual({ id: "", params: [] });
    expect(pickDefaultSelection([], "opus")).toEqual({ id: "opus", params: [] });
  });

  it("uses the named default variant", () => {
    expect(defaultParamsFor(grok)).toEqual([{ id: "effort", value: "high" }]);
    expect(defaultParamsFor(composer)).toEqual([]);
  });

  it("matches a variant even with extra params", () => {
    const v = matchingVariant(grok, [
      { id: "effort", value: "xhigh" },
      { id: "fast", value: "true" },
    ]);
    expect(v?.displayName).toBe("Extra high");
  });

  it("fills fallback metadata when the live list omits it", () => {
    const merged = mergeModelCatalog([{ id: "grok-4.6", displayName: "Grok 4.6" }], [grok]);
    expect(merged[0]?.variants?.some((v) => v.params.some((p) => p.value === "xhigh"))).toBe(true);
  });

  it("returns the fallback catalog when the live list is empty", () => {
    const merged = mergeModelCatalog([], [grok, composer]);
    expect(merged.map((m) => m.id)).toEqual(["grok-4.6", "composer-2.5"]);
  });

  it("keeps every live model, not only the fallback ids", () => {
    const merged = mergeModelCatalog(
      [
        { id: "claude-opus-4.6", displayName: "Opus 4.6" },
        { id: "gpt-5.2", displayName: "GPT-5.2" },
        grok,
      ],
      [grok, composer],
    );
    expect(merged.map((m) => m.id)).toEqual(["claude-opus-4.6", "gpt-5.2", "grok-4.6"]);
  });
});
