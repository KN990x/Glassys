import { describe, expect, it } from "vitest";
import { AdapterError } from "@glassys/adapter-contract";
import { runResultErrorMessage, wrapSdkError } from "./errors.js";

describe("wrapSdkError", () => {
  it("tags send failures as run phase", () => {
    expect(() => wrapSdkError(new Error("mid-thread"), "run")).toThrow(AdapterError);
    try {
      wrapSdkError(new Error("mid-thread"), "run");
    } catch (err) {
      expect(err).toMatchObject({ phase: "run", message: "mid-thread" });
    }
  });

  it("wraps non-Error throws", () => {
    try {
      wrapSdkError("boom", "startup");
    } catch (err) {
      expect(err).toBeInstanceOf(AdapterError);
      expect(err).toMatchObject({ phase: "startup", message: "boom" });
    }
  });

  it("rethrows AdapterError unchanged", () => {
    const inner = new AdapterError("already", "run", true);
    try {
      wrapSdkError(inner, "startup");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBe(inner);
    }
  });
});

describe("runResultErrorMessage", () => {
  it("prefers an explicit message from wait()", () => {
    expect(runResultErrorMessage({ status: "error", message: "model refused" })).toBe("model refused");
    expect(runResultErrorMessage({ status: "error", error: "disk full" })).toBe("disk full");
    expect(runResultErrorMessage({ status: "error", error: { message: "tool failed" } })).toBe("tool failed");
  });

  it("falls back to run id then a generic label", () => {
    expect(runResultErrorMessage({ status: "error", id: "run-9" })).toBe("Run failed (run-9)");
    expect(runResultErrorMessage({ status: "error" })).toBe("Run failed");
  });
});
