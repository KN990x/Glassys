import { describe, expect, it } from "vitest";
import { requireHostCommand } from "./probe.js";

describe("requireHostCommand", () => {
  it("resolves for a binary that exists", async () => {
    await expect(requireHostCommand("node", "missing node")).resolves.toBeUndefined();
  });

  it("throws when the binary is not on PATH", async () => {
    await expect(
      requireHostCommand("glassys-definitely-not-a-binary", "OpenCode CLI is not on PATH"),
    ).rejects.toThrow(/OpenCode CLI is not on PATH/);
  });
});
