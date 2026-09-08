import { describe, expect, it } from "vitest";
import { filterPaletteItems, type PaletteItem } from "./CommandPalette";

describe("CommandPalette filter", () => {
  const items: PaletteItem[] = [
    { id: "new", group: "product", label: "New thread", run: () => undefined },
    { id: "tpl:status", group: "template", label: "Host status", hint: "/status", run: () => undefined },
  ];

  it("filters by label, hint, and id", () => {
    expect(filterPaletteItems(items, "status").map((i) => i.id)).toEqual(["tpl:status"]);
    expect(filterPaletteItems(items, "thread").map((i) => i.id)).toEqual(["new"]);
    expect(filterPaletteItems(items, "")).toHaveLength(2);
  });
});
