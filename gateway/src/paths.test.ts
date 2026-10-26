import { describe, expect, it } from "vitest";
import { redactLogExtra } from "./paths.js";

describe("redactLogExtra", () => {
  it("redacts secret-looking values in error strings", () => {
    const out = redactLogExtra({
      error: "invalid key sk-abcdefghijklmnopqrstuvwxyz and cursor_abcdefghijk",
    });
    expect(String(out?.error)).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    expect(String(out?.error)).not.toContain("cursor_abcdefghijk");
    expect(String(out?.error)).toContain("[redacted]");
  });

  it("redacts fields whose names look secret", () => {
    expect(redactLogExtra({ apiKey: "visible-secret" })?.apiKey).toBe("[redacted]");
  });
});

describe("isSafeId", () => {
  it("refuses empty ids, either separator and parent steps", async () => {
    const { isSafeId } = await import("./paths.js");
    expect(isSafeId("3f2a9c1e-7b4d-4e8a-9f00-123456789abc")).toBe(true);
    for (const bad of ["", "a/b", "a\\b", "..", "x..y", undefined, null]) expect(isSafeId(bad)).toBe(false);
  });
});
