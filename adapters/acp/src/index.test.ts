import { describe, expect, it } from "vitest";
import { acpShouldLoadSession } from "./index.js";

describe("acpShouldLoadSession", () => {
  it("is false unless the agent advertises loadSession: true", () => {
    expect(acpShouldLoadSession(undefined)).toBe(false);
    expect(acpShouldLoadSession({})).toBe(false);
    expect(acpShouldLoadSession({ loadSession: false })).toBe(false);
    expect(acpShouldLoadSession({ session: { loadSession: true } })).toBe(true);
    expect(acpShouldLoadSession({ loadSession: true })).toBe(true);
  });
});
