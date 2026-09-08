import { describe, expect, it } from "vitest";
import {
  defaultParamsFor,
  matchingVariant,
  mergeModelCatalog,
  modelOptionLabel,
  normalizeCatalogItem,
  pickDefaultSelection,
  variantOptionLabel,
} from "./models.js";
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

  it("collapses live effort×fast variants that repeat the model name", () => {
    const efforts = ["xhigh", "high", "medium", "low"] as const;
    const live: ModelCatalogItem = {
      id: "grok-4.6",
      displayName: "Cursor Grok 4.6",
      parameters: [
        {
          id: "effort",
          displayName: "Effort",
          values: [
            { value: "low", displayName: "Low" },
            { value: "medium", displayName: "Medium" },
            { value: "high", displayName: "High" },
            { value: "xhigh", displayName: "Extra high" },
          ],
        },
        {
          id: "fast",
          displayName: "Fast",
          values: [
            { value: "false" },
            { value: "true" },
          ],
        },
      ],
      variants: efforts.flatMap((effort) =>
        (["false", "true"] as const).map((fast) => ({
          displayName: "Cursor Grok 4.6",
          params: [
            { id: "effort", value: effort },
            { id: "fast", value: fast },
          ],
        })),
      ),
    };
    const merged = mergeModelCatalog([live], [grok]);
    const item = merged[0]!;
    expect(item.variants).toHaveLength(4);
    expect(item.variants?.map((v) => v.displayName)).toEqual(["Extra high", "High", "Medium", "Low"]);
    expect(item.variants?.every((v) => v.params.every((p) => p.id === "effort"))).toBe(true);
    expect(item.parameters?.some((p) => p.id === "fast")).toBe(true);
  });

  it("prefers distinct fallback variants when live names are unusable and not cartesian", () => {
    const live: ModelCatalogItem = {
      id: "grok-4.6",
      displayName: "Cursor Grok 4.6",
      variants: [
        { displayName: "Cursor Grok 4.6", params: [{ id: "effort", value: "xhigh" }] },
        { displayName: "Cursor Grok 4.6", params: [{ id: "effort", value: "high" }] },
      ],
    };
    const item = normalizeCatalogItem(live, grok);
    expect(item.variants?.map((v) => v.displayName)).toEqual(["Extra high", "High"]);
  });

  it("disambiguates colliding model and variant labels", () => {
    const a = { id: "openai/gpt-4", displayName: "GPT-4" };
    const b = { id: "azure/gpt-4", displayName: "GPT-4" };
    expect(modelOptionLabel(a, [a, b])).toBe("GPT-4 (openai/gpt-4)");
    const model: ModelCatalogItem = {
      id: "grok-4.6",
      displayName: "Cursor Grok 4.6",
      variants: [
        { displayName: "Cursor Grok 4.6", params: [{ id: "effort", value: "xhigh" }] },
        { displayName: "Cursor Grok 4.6", params: [{ id: "effort", value: "high" }] },
      ],
      parameters: [{ id: "effort", values: [{ value: "xhigh", displayName: "Extra high" }, { value: "high", displayName: "High" }] }],
    };
    expect(variantOptionLabel(model, model.variants![0]!, 0, model.variants!)).toBe("Extra high");
  });
});
