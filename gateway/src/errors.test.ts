import { describe, expect, it, vi } from "vitest";
import { AdapterError } from "@glassys/adapter-contract";
import { isActiveRunError, publicErrorMessage } from "./errors.js";

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

describe("publicErrorMessage", () => {
  it("keeps an Error's message and logs anything else instead of returning it", () => {
    expect(publicErrorMessage(new Error("login timed out"), "login failed")).toBe("login timed out");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const thrown = "Error: boom\n    at secret (/home/op/glassys/gateway/src/x.ts:1:1)";
      expect(publicErrorMessage(thrown, "login failed")).toBe("login failed");
      expect(spy).toHaveBeenCalledOnce();
      expect(String(spy.mock.calls[0]?.[0])).toContain("/home/op/glassys");
    } finally {
      spy.mockRestore();
    }
  });
});
