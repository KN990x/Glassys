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

describe("requireRunnableCommand", () => {
  it("passes a command that runs and names one that exits badly", async () => {
    const { requireRunnableCommand } = await import("./probe.js");
    await expect(requireRunnableCommand(process.execPath, ["--version"], "Node")).resolves.toBeUndefined();
    await expect(requireRunnableCommand(process.execPath, ["-e", "process.exit(3)"], "Node")).rejects.toThrow(/exited with 3.*does not run/);
    await expect(requireRunnableCommand("glassys-no-such-cli", ["--version"], "Nope")).rejects.toThrow(/not on PATH/);
  });
});
