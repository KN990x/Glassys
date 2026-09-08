import { describe, expect, it } from "vitest";
import { geminiAdapter, GEMINI_STATIC_CATALOG } from "./index.js";

describe("gemini adapter", () => {
  it("advertises a static catalog", () => {
    expect(geminiAdapter.capabilities.liveCatalog).toBe(false);
    expect(GEMINI_STATIC_CATALOG.length).toBeGreaterThan(0);
  });

  it("listModels reports fallback even when the SDK is present", async () => {
    const listed = await geminiAdapter.listModels();
    expect(listed.source).toBe("fallback");
    expect(listed.models.map((m) => m.id)).toEqual(GEMINI_STATIC_CATALOG.map((m) => m.id));
    expect(listed.error).toBeTruthy();
  });

  it("does not advertise resume until the SDK honors it", () => {
    expect(geminiAdapter.capabilities.resume).toBe(false);
  });

  it("probe fails when the SDK is not installed", async () => {
    await expect(geminiAdapter.probe?.()).rejects.toThrow(/Gemini CLI SDK is not available/);
  });
});
