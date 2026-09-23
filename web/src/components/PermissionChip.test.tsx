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

  it("puts the risk in the glyph and the detail in the tooltip", async () => {
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
    const chip = host.querySelector("button") as HTMLButtonElement;
    expect(chip.textContent).toContain("Auto-run");
    expect(chip.getAttribute("title")).toContain("Sandbox off");
    /* Auto-run with no sandbox is the most exposed state this host can be in. */
    expect(chip.className).toContain("risk-danger");
  });

  it("does not patch options when the operator cancels the archive confirm", async () => {
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
    const sandbox = host.querySelector('button[role="switch"]') as HTMLButtonElement;
    await act(async () => {
      sandbox.click();
    });
    expect(host.querySelector(".confirm-panel")).toBeTruthy();
    await act(async () => {
      [...host.querySelectorAll("button")].find((b) => b.textContent === "Cancel")?.click();
    });
    expect(host.querySelector(".confirm-panel")).toBeNull();
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it("patches options once the operator confirms the archive", async () => {
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
    await act(async () => {
      (host.querySelector('button[role="switch"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      [...host.querySelectorAll("button")].find((b) => b.textContent === "Archive and continue")?.click();
      await Promise.resolve();
    });
    expect(saveConfig).toHaveBeenCalled();
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
    expect(host.querySelector(".pop")).toBeTruthy();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(host.querySelector(".pop")).toBeNull();
    expect(host.querySelector("button")?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      host.querySelector("button")?.click();
    });
    expect(host.querySelector(".pop")).toBeTruthy();
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(host.querySelector(".pop")).toBeNull();
  });
});
