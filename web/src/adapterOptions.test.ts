import { describe, expect, it } from "vitest";
import type { AdapterPublicInfo } from "@glassys/protocol";
import { defaultOptionsFor, optionsForAdapter, adapterKeyConfigured, setAutoRun, setPermissionMode, archivesLiveThread, cwdExposesDataDir, sandboxState } from "./adapterOptions";

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

describe("cwdExposesDataDir", () => {
  const dataDir = "/home/op/glassys/data";
  it("warns when the workspace contains the data dir and nothing sandboxes the agent", () => {
    expect(cwdExposesDataDir({ cwd: "/home/op", dataDir, sandbox: false, sandboxSupported: true })).toBe(true);
    expect(cwdExposesDataDir({ cwd: "/home/op/", dataDir, sandbox: true, sandboxSupported: false })).toBe(true);
    expect(cwdExposesDataDir({ cwd: "/", dataDir, sandbox: false, sandboxSupported: false })).toBe(true);
  });
  it("stays quiet with a sandbox or a workspace elsewhere", () => {
    expect(cwdExposesDataDir({ cwd: "/home/op", dataDir, sandbox: true, sandboxSupported: true })).toBe(false);
    expect(cwdExposesDataDir({ cwd: "/home/op/stacks", dataDir, sandbox: false, sandboxSupported: false })).toBe(false);
    expect(cwdExposesDataDir({ cwd: "/home/op/glassys/data2", dataDir, sandbox: false, sandboxSupported: false })).toBe(false);
    expect(cwdExposesDataDir({ cwd: "/home/op", dataDir: undefined, sandbox: false, sandboxSupported: false })).toBe(false);
  });
});

describe("sandboxState", () => {
  const codex = { sandbox: false, sandboxModes: ["read-only", "workspace-write", "danger-full-access"] };
  it("counts a Codex level short of full access as sandboxed", () => {
    expect(sandboxState(codex, { sandboxMode: "workspace-write" })).toEqual({ supported: true, on: true });
    expect(sandboxState(codex, { sandboxMode: "danger-full-access" })).toEqual({ supported: true, on: false });
  });
  it("does not count a level left to the adapter's config", () => {
    expect(sandboxState(codex, {})).toEqual({ supported: true, on: false });
  });
  it("keeps the plain on/off sandbox", () => {
    expect(sandboxState({ sandbox: true }, { sandbox: true })).toEqual({ supported: true, on: true });
    expect(sandboxState({ sandbox: false }, { sandbox: true })).toEqual({ supported: false, on: false });
  });
});
