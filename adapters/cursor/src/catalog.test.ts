import { describe, expect, it } from "vitest";
import {
  CURSOR_FLAGSHIP_MODEL_ID,
  CURSOR_STATIC_CATALOG,
  cursorCatalogFromListed,
  cursorParamsForFlagship,
  normalizeCursorConfig,
  parseCursorModelList,
} from "./catalog.js";

const longLive = [
  { id: "claude-opus-4.6", displayName: "Opus 4.6" },
  { id: "gpt-5.2", displayName: "GPT-5.2" },
  { id: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro" },
  { id: "composer-2.5", displayName: "Composer 2.5", parameters: [{ id: "fast", values: [{ value: "true" }, { value: "false" }] }] },
  {
    id: "grok-4.6",
    displayName: "Grok 4.6",
    parameters: CURSOR_STATIC_CATALOG[0]?.parameters,
  },
  { id: "auto", displayName: "Auto" },
  {
    id: "auto-smart",
    displayName: "Auto (Router)",
    parameters: [
      {
        id: "optimize_for",
        displayName: "Optimize for",
        values: [
          { value: "cost", displayName: "Cost" },
          { value: "balanced", displayName: "Balanced" },
          { value: "intelligence", displayName: "Intelligence" },
        ],
      },
    ],
  },
];

describe("cursor catalog", () => {
  it("parses a wrapped SDK payload and keeps every model", () => {
    const parsed = parseCursorModelList({ models: longLive });
    expect(parsed.map((m) => m.id)).toEqual([
      "claude-opus-4.6",
      "gpt-5.2",
      "gemini-2.5-pro",
      "composer-2.5",
      "grok-4.6",
      "auto",
      "auto-smart",
    ]);
  });

  it("parses { data } and { items } the same way", () => {
    expect(parseCursorModelList({ data: longLive })).toHaveLength(7);
    expect(parseCursorModelList({ items: longLive })).toHaveLength(7);
  });

  it("merges live list, fills grok variants, and sorts flagship first", () => {
    const result = cursorCatalogFromListed(longLive);
    expect(result.source).toBe("live");
    expect(result.models[0]?.id).toBe(CURSOR_FLAGSHIP_MODEL_ID);
    expect(result.models[0]?.variants?.some((v) => v.params.some((p) => p.value === "xhigh"))).toBe(true);
    expect(result.models.map((m) => m.id)).toContain("auto-smart");
    expect(result.models.map((m) => m.id)).toContain("gpt-5.2");
  });

  it("falls back when the payload is empty", () => {
    const result = cursorCatalogFromListed({ models: [] });
    expect(result.source).toBe("fallback");
    expect(result.error).toMatch(/no models/i);
    expect(result.models.map((m) => m.id)).toContain("grok-4.6");
    expect(result.models.map((m) => m.id)).toContain("composer-2.5");
  });

  it("collapses a live Grok cartesian catalog into labeled effort plus Fast", () => {
    const efforts = ["xhigh", "high", "medium", "low"] as const;
    const listed = [
      {
        id: "grok-4.6",
        displayName: "Cursor Grok 4.6",
        parameters: CURSOR_STATIC_CATALOG[0]?.parameters,
        variants: efforts.flatMap((effort) =>
          (["false", "true"] as const).map((fast) => ({
            displayName: "Cursor Grok 4.6",
            params: [
              { id: "effort", value: effort },
              { id: "fast", value: fast },
            ],
          })),
        ),
      },
    ];
    const result = cursorCatalogFromListed(listed);
    expect(result.source).toBe("live");
    const grok = result.models.find((m) => m.id === CURSOR_FLAGSHIP_MODEL_ID);
    expect(grok?.variants).toHaveLength(4);
    expect(grok?.variants?.map((v) => v.displayName)).toEqual(["Extra high", "High", "Medium", "Low"]);
    expect(grok?.variants?.some((v) => v.displayName === "Cursor Grok 4.6")).toBe(false);
    expect(grok?.parameters?.some((p) => p.id === "fast")).toBe(true);
  });

  it("defaults grok to extra high", () => {
    expect(cursorParamsForFlagship(CURSOR_STATIC_CATALOG[0]!)).toEqual([{ id: "effort", value: "xhigh" }]);
    expect(CURSOR_STATIC_CATALOG[0]?.variants?.find((v) => v.isDefault)?.params).toEqual([{ id: "effort", value: "xhigh" }]);
  });

  it("rewrites an empty model to grok-4.6 extra high and keeps Composer when chosen", () => {
    const empty = normalizeCursorConfig({
      adapter: "cursor",
      cwd: "/tmp",
      model: "",
      modelParams: [],
      options: {},
    });
    expect(empty.model).toBe(CURSOR_FLAGSHIP_MODEL_ID);
    expect(empty.modelParams).toEqual([{ id: "effort", value: "xhigh" }]);
    const composer = normalizeCursorConfig({
      adapter: "cursor",
      cwd: "/tmp",
      model: "composer-2.5",
      modelParams: [],
      options: {},
    });
    expect(composer.model).toBe("composer-2.5");
    const kept = normalizeCursorConfig({
      adapter: "cursor",
      cwd: "/tmp",
      model: "composer-2.5",
      modelParams: [{ id: "fast", value: "true" }],
      options: {},
    });
    expect(kept.model).toBe("composer-2.5");
    expect(kept.modelParams).toEqual([{ id: "fast", value: "true" }]);
  });
});
