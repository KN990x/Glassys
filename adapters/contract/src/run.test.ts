import { describe, expect, it } from "vitest";
import { AdapterError } from "./types.js";
import { pendingRun } from "./run.js";

describe("pendingRun", () => {
  it("surfaces AdapterError from wait()", async () => {
    const run = pendingRun("r1", async () => {
      throw new AdapterError("boom", "run");
    });
    await expect(run.wait()).rejects.toMatchObject({ message: "boom", phase: "run" });
  });

  it("returns cancelled when abort wins", async () => {
    const run = pendingRun("r2", async ({ signal }) => {
      await new Promise<void>((resolve, reject) => {
        signal.addEventListener("abort", () => reject(Object.assign(new Error("Aborted"), { name: "AbortError" })));
      });
      return "finished";
    });
    await run.cancel();
    await expect(run.wait()).resolves.toBe("cancelled");
  });

  it("ignores a cancel that arrives after the run settled", async () => {
    let aborted = false;
    const run = pendingRun("r3", async ({ signal }) => {
      signal.addEventListener("abort", () => {
        aborted = true;
      });
      return "finished";
    });
    await expect(run.wait()).resolves.toBe("finished");
    await run.cancel();
    expect(aborted).toBe(false);
  });

  it("does not leave an early failure unhandled before wait() is called", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const run = pendingRun("r4", async () => {
        throw new AdapterError("early", "run");
      });
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toEqual([]);
      await expect(run.wait()).rejects.toMatchObject({ message: "early" });
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
