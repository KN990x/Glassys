import { describe, expect, it } from "vitest";
import { AdapterError } from "@glassys/adapter-contract";
import { isActiveRunError } from "./errors.js";

describe("isActiveRunError", () => {
  it("accepts retryable AdapterError and known busy messages", () => {
    expect(isActiveRunError(new AdapterError("nope", "run", true))).toBe(true);
    expect(isActiveRunError(new Error("agent already has an active run"))).toBe(true);
    expect(isActiveRunError(new Error("Agent is busy"))).toBe(true);
  });

  it("does not treat generic network busy as an active run", () => {
    expect(isActiveRunError(new Error("ECONNRESET: resource is busy"))).toBe(false);
    expect(isActiveRunError(new AdapterError("network down", "startup", false))).toBe(false);
  });
});
