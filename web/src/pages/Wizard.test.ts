import { describe, expect, it } from "vitest";
import type { AdapterPublicInfo } from "@glassys/protocol";
import { pickWizardAdapter, wizardCredentialReady, wizardFinishPatch } from "./Wizard";

const caps = {
  models: true,
  sandbox: false,
  settingSources: false,
  autoRun: false,
  cancel: true,
  resume: false,
  discover: false,
  toolConfirmation: "none" as const,
  auth: { kind: "api-key" as const, envNames: [] },
};

const cursor: AdapterPublicInfo = {
  id: "cursor",
  displayName: "Cursor",
  capabilities: { ...caps, resume: true, sandbox: true },
  available: { ok: true },
  auth: { loggedIn: false, apiKeyConfigured: false },
};

const gemini: AdapterPublicInfo = {
  id: "gemini",
  displayName: "Gemini CLI",
  capabilities: caps,
  available: { ok: false, error: "SDK missing" },
  auth: { loggedIn: false, apiKeyConfigured: false },
};

describe("wizardFinishPatch", () => {
  it("persists cwd and model when finishing onboarding", () => {
    expect(
      wizardFinishPatch({
        adapterId: "cursor",
        cwd: "/tmp/project",
        model: "grok-4.6",
        modelParams: [{ id: "effort", value: "xhigh" }],
        options: { sandbox: true, autoRun: false },
      }),
    ).toEqual({
      agent: {
        adapter: "cursor",
        cwd: "/tmp/project",
        model: "grok-4.6",
        modelParams: [{ id: "effort", value: "xhigh" }],
        options: { sandbox: true, autoRun: false },
      },
      onboarding: { completed: true },
    });
  });
});

describe("pickWizardAdapter", () => {
  it("skips adapters that are not available on this host", () => {
    expect(pickWizardAdapter([gemini, cursor], "gemini")).toBe("cursor");
    expect(pickWizardAdapter([cursor, gemini], "cursor")).toBe("cursor");
    expect(pickWizardAdapter([gemini], "gemini")).toBeUndefined();
  });
});

describe("wizardCredentialReady", () => {
  it("requires SDK login or a key for Cursor, not for other auth kinds", () => {
    expect(wizardCredentialReady({ authKind: "sdk-login" })).toBe(false);
    expect(wizardCredentialReady({ authKind: "sdk-login", loggedIn: true })).toBe(true);
    expect(wizardCredentialReady({ authKind: "sdk-login", keyConfigured: true })).toBe(true);
    expect(wizardCredentialReady({ authKind: "sdk-login", apiKeyDraft: "cursor_x" })).toBe(true);
    expect(wizardCredentialReady({ authKind: "api-key" })).toBe(true);
    expect(wizardCredentialReady({ authKind: "cli-binary" })).toBe(true);
  });
});
