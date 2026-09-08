import { describe, expect, it } from "vitest";
import type { AdapterPublicInfo } from "@glassys/protocol";
import { defaultOptionsFor, optionsForAdapter, adapterKeyConfigured, setAutoRun, setPermissionMode, archivesLiveThread } from "./adapterOptions";

const cursor: AdapterPublicInfo = {
  id: "cursor",
  displayName: "Cursor",
  capabilities: {
    models: true,
    sandbox: true,
    settingSources: true,
    autoRun: true,
    cancel: true,
    resume: true,
    discover: false,
    toolConfirmation: "auto-review-deny",
    auth: { kind: "sdk-login", envNames: [] },
  },
  auth: { loggedIn: false, apiKeyConfigured: false },
};

const acp: AdapterPublicInfo = {
  id: "acp",
  displayName: "ACP",
  capabilities: {
    models: true,
    sandbox: false,
    settingSources: false,
    autoRun: true,
    cancel: true,
    resume: true,
    discover: true,
    toolConfirmation: "none",
    auth: { kind: "cli-binary", envNames: [] },
  },
  auth: { loggedIn: false, apiKeyConfigured: false },
};

describe("optionsForAdapter", () => {
  it("keeps saved options when the adapter already matches config", () => {
    const saved = {
      adapter: "acp",
      options: { command: "npx", args: ["-y", "foo"], autoRun: false },
    };
    expect(optionsForAdapter(acp, saved)).toMatchObject({
      command: "npx",
      args: ["-y", "foo"],
      autoRun: false,
    });
  });

  it("uses defaults when switching to a different adapter", () => {
    const saved = { adapter: "acp", options: { command: "npx" } };
    expect(optionsForAdapter(cursor, saved)).toEqual(defaultOptionsFor(cursor));
    expect(optionsForAdapter(cursor, saved).settingSources).toEqual(["project", "user"]);
  });
});

describe("setAutoRun", () => {
  it("maps Claude auto-run onto permissionMode", () => {
    expect(
      setAutoRun({ permissionMode: "bypassPermissions", autoRun: true }, false, "permission-mode"),
    ).toMatchObject({
      autoRun: false,
      permissionMode: "dontAsk",
    });
    expect(setPermissionMode({ autoRun: true, permissionMode: "bypassPermissions" }, "dontAsk")).toMatchObject({
      autoRun: false,
      permissionMode: "dontAsk",
    });
    expect(setAutoRun({ autoRun: true }, false, "auto-review-deny")).toMatchObject({ autoRun: false });
    expect(setAutoRun({ autoRun: true }, false, "auto-review-deny").permissionMode).toBeUndefined();
  });
});

describe("archivesLiveThread", () => {
  it("is true when adapter, cwd, or options change", () => {
    const before = { adapter: "cursor", cwd: "/tmp/a", options: { sandbox: false, autoRun: true } };
    expect(archivesLiveThread(before, { ...before })).toBe(false);
    expect(archivesLiveThread(before, { ...before, cwd: "/tmp/b" })).toBe(true);
    expect(archivesLiveThread(before, { ...before, adapter: "claude" })).toBe(true);
    expect(archivesLiveThread(before, { ...before, options: { sandbox: true, autoRun: true } })).toBe(true);
  });
});

describe("adapterKeyConfigured", () => {
  it("treats the legacy cursorApiKey flag as configured for Cursor", () => {
    expect(
      adapterKeyConfigured({ adapters: {}, cursorApiKey: { configured: true } }, "cursor"),
    ).toBe(true);
    expect(
      adapterKeyConfigured({ adapters: {}, cursorApiKey: { configured: true } }, "claude"),
    ).toBe(false);
    expect(
      adapterKeyConfigured(
        { adapters: { claude: { apiKey: { configured: true } } }, cursorApiKey: { configured: false } },
        "claude",
      ),
    ).toBe(true);
  });
});
