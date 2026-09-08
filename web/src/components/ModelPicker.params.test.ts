import { describe, expect, it } from "vitest";
import { paramsForSelection } from "./ModelPicker";
import type { ModelCatalogItem } from "@glassys/protocol";

const grok: ModelCatalogItem = {
  id: "grok-4.6",
  displayName: "Grok 4.6",
  parameters: [
    {
      id: "effort",
      values: [{ value: "high" }, { value: "xhigh" }],
    },
    {
      id: "fast",
      values: [
        { value: "false", displayName: "Standard" },
        { value: "true", displayName: "Fast" },
      ],
    },
  ],
  variants: [
    { displayName: "Extra high", params: [{ id: "effort", value: "xhigh" }], isDefault: true },
    { displayName: "High", params: [{ id: "effort", value: "high" }] },
  ],
};

describe("paramsForSelection", () => {
  it("keeps extra params such as fast with the flagship variant", () => {
    const params = paramsForSelection(grok);
    expect(params).toEqual(
      expect.arrayContaining([
        { id: "effort", value: "xhigh" },
        { id: "fast", value: "false" },
      ]),
    );
  });

  it("preserves a preferred extra when the model matches", () => {
    const params = paramsForSelection(grok, {
      id: "grok-4.6",
      params: [
        { id: "effort", value: "xhigh" },
        { id: "fast", value: "true" },
      ],
    });
    expect(params.find((p) => p.id === "fast")?.value).toBe("true");
  });

  it("fills extra defaults when preferred only has variant params", () => {
    const params = paramsForSelection(grok, {
      id: "grok-4.6",
      params: [{ id: "effort", value: "xhigh" }],
    });
    expect(params).toEqual(
      expect.arrayContaining([
        { id: "effort", value: "xhigh" },
        { id: "fast", value: "false" },
      ]),
    );
  });
});
