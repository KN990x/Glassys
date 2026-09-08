import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { defaultConfig, type AdapterCapabilities, type RedactedConfig } from "@glassys/protocol";
import { I18nProvider } from "../i18n";
import { PermissionChip } from "./PermissionChip";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const saveConfig = vi.hoisted(() => vi.fn());

vi.mock("../api", () => ({
  api: { saveConfig: (...args: unknown[]) => saveConfig(...args) },
}));

const caps: AdapterCapabilities = {
  models: true,
  sandbox: true,
  settingSources: true,
  autoRun: true,
  cancel: true,
  resume: true,
  discover: false,
  toolConfirmation: "auto-review-deny",
  auth: { kind: "sdk-login", envNames: [] },
};

function cfg(): RedactedConfig {
  const base = defaultConfig();
  base.agent.options = { sandbox: false, autoRun: true };
  return {
    ...base,
    secrets: { operatorPassword: { configured: true }, adapters: {}, cursorApiKey: { configured: false } },
  };
}

describe("PermissionChip", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    saveConfig.mockReset();
    vi.unstubAllGlobals();
  });

  it("shows sandbox off on the chip when sandbox is disabled", async () => {
    host = document.createElement("div");
    document.body.append(host);
    await act(async () => {
      root = createRoot(host);
      root.render(
        <I18nProvider locale="en">
          <PermissionChip config={cfg()} caps={caps} onConfig={() => undefined} />
        </I18nProvider>,
      );
    });
    expect(host.querySelector("button")?.textContent).toContain("Sandbox off");
  });

  it("does not patch options when the operator cancels the archive confirm", async () => {
    vi.stubGlobal("confirm", () => false);
    host = document.createElement("div");
    document.body.append(host);
    await act(async () => {
      root = createRoot(host);
      root.render(
        <I18nProvider locale="en">
          <PermissionChip config={cfg()} caps={caps} onConfig={() => undefined} />
        </I18nProvider>,
      );
    });
    await act(async () => {
      host.querySelector("button")?.click();
    });
    const checkbox = host.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => {
      checkbox.click();
    });
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it("closes the popover on Escape and click outside", async () => {
    host = document.createElement("div");
    document.body.append(host);
    await act(async () => {
      root = createRoot(host);
      root.render(
        <I18nProvider locale="en">
          <PermissionChip config={cfg()} caps={caps} onConfig={() => undefined} />
        </I18nProvider>,
      );
    });
    await act(async () => {
      host.querySelector("button")?.click();
    });
    expect(host.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector(".chip-pop")).toBeTruthy();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(host.querySelector(".chip-pop")).toBeNull();
    expect(host.querySelector("button")?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      host.querySelector("button")?.click();
    });
    expect(host.querySelector(".chip-pop")).toBeTruthy();
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(host.querySelector(".chip-pop")).toBeNull();
  });
});
