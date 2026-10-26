import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { AdminUpdateInfo } from "@glassys/protocol";
import { I18nProvider } from "../../i18n";

const restart = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../../api", () => ({ api: { restart, adminUpdate: vi.fn(), upgrade: vi.fn(), adminUpdateCheck: vi.fn() } }));

import { UpdatesTab } from "./UpdatesTab";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const update: AdminUpdateInfo = {
  version: "0.1.0",
  protocolVersion: 1,
  git: { sha: "b".repeat(40), branch: "main", dirty: false },
  running: { commit: "a".repeat(40), startedAt: "2026-10-26T10:00:00.000Z" },
  service: "systemd",
};

describe("UpdatesTab", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    restart.mockClear();
  });

  async function render(props: { reloadNeeded: boolean; confirm: () => Promise<boolean> }) {
    host = document.createElement("div");
    document.body.append(host);
    await act(async () => {
      root = createRoot(host);
      root.render(
        <I18nProvider locale="en">
          <UpdatesTab
            reloadNeeded={props.reloadNeeded}
            update={update}
            setUpdate={() => undefined}
            behind={null}
            setBehind={() => undefined}
            restartNote=""
            setRestartNote={() => undefined}
            setError={() => undefined}
            confirm={props.confirm}
          />
        </I18nProvider>,
      );
    });
  }

  function restartButton(): HTMLButtonElement {
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("button.danger")];
    const button = buttons.find((b) => /restart/i.test(b.textContent ?? ""));
    if (!button) throw new Error("no restart button");
    return button;
  }

  it("asks before it restarts the gateway, and does nothing when the ask is declined", async () => {
    const confirm = vi.fn(async () => false);
    await render({ reloadNeeded: false, confirm });
    await act(async () => restartButton().click());
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(restart).not.toHaveBeenCalled();
  });

  it("restarts once the operator confirms", async () => {
    await render({ reloadNeeded: false, confirm: async () => true });
    await act(async () => restartButton().click());
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it("shows the reload banner only when the page is older than the gateway", async () => {
    await render({ reloadNeeded: false, confirm: async () => false });
    const withoutBanner = host.textContent ?? "";
    act(() => root.unmount());
    host.remove();
    await render({ reloadNeeded: true, confirm: async () => false });
    expect((host.textContent ?? "").length).toBeGreaterThan(withoutBanner.length);
    expect(host.querySelector("button.primary")).toBeTruthy();
  });
});
