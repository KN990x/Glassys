import { describe, expect, it } from "vitest";
import type { Adapter } from "@glassys/adapter-contract";
import { probeAdapter } from "./adapters.js";

const base: Adapter = {
  id: "fake",
  displayName: "Fake",
  capabilities: {
    models: true,
    sandbox: false,
    settingSources: false,
    autoRun: false,
    cancel: true,
    resume: false,
    discover: false,
    toolConfirmation: "none",
    auth: { kind: "api-key", envNames: [] },
  },
  async listModels() {
    return { models: [], source: "fallback" };
  },
  async create() {
    throw new Error("nope");
  },
  async resume() {
    throw new Error("nope");
  },
};

describe("probeAdapter", () => {
  it("is ok when the adapter has no probe", async () => {
    expect(await probeAdapter(base)).toEqual({ ok: true });
  });

  it("surfaces probe failures", async () => {
    expect(
      await probeAdapter({
        ...base,
        async probe() {
          throw new Error("Gemini CLI SDK is not available");
        },
      }),
    ).toEqual({ ok: false, error: "Gemini CLI SDK is not available" });
  });
});
