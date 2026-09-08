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
