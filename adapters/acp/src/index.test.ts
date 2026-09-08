import { describe, expect, it } from "vitest";
import { acpResumeUnsupported, acpShouldLoadSession } from "./index.js";

describe("acpShouldLoadSession", () => {
  it("is false unless the agent advertises loadSession: true", () => {
    expect(acpShouldLoadSession(undefined)).toBe(false);
    expect(acpShouldLoadSession({})).toBe(false);
    expect(acpShouldLoadSession({ loadSession: false })).toBe(false);
    expect(acpShouldLoadSession({ session: { loadSession: true } })).toBe(true);
    expect(acpShouldLoadSession({ loadSession: true })).toBe(true);
  });
});

describe("acpResumeUnsupported", () => {
  it("is true when a resume id exists but the agent cannot resume or load", () => {
    expect(acpResumeUnsupported("s1", undefined)).toBe(true);
    expect(acpResumeUnsupported("s1", { session: { resume: true } })).toBe(false);
    expect(acpResumeUnsupported("s1", { loadSession: true })).toBe(false);
    expect(acpResumeUnsupported(undefined, {})).toBe(false);
  });
});
