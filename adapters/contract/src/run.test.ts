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
});
