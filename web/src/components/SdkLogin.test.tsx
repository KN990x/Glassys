import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { I18nProvider } from "../i18n";

const state = vi.hoisted(() => ({ started: false, finishLogin: (() => undefined) as () => void }));

vi.mock("../api", () => ({
  api: {
    /* The previous attempt was cancelled; the gateway says so until the new one has started. */
    adapterStatus: vi.fn(async () =>
      state.started ? { loggedIn: false, loginStatus: "pending", loginUrl: "https://login.example/x" } : { loggedIn: false, loginStatus: "cancelled" },
    ),
    adapterLogin: vi.fn(
      () =>
        new Promise((resolve) => {
          state.finishLogin = () => {
            state.started = true;
            resolve({ url: "https://login.example/x" });
          };
        }),
    ),
    adapterLoginCancel: vi.fn(async () => undefined),
  },
}));

import { SdkLoginControls } from "./SdkLogin";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("SdkLoginControls", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("does not let the previous attempt's cancelled status stop a new login", async () => {
    host = document.createElement("div");
    document.body.append(host);
    await act(async () => {
      root = createRoot(host);
      root.render(
        <I18nProvider locale="en">
          <SdkLoginControls adapterId="cursor" onSignedIn={() => undefined} />
        </I18nProvider>,
      );
    });
    const button = host.querySelector("button.primary") as HTMLButtonElement;
    await act(async () => button.click());
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    await act(async () => state.finishLogin());
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect((host.querySelector("button.primary") as HTMLButtonElement).disabled).toBe(true);
    expect(host.querySelector(".login-url code")?.textContent).toBe("https://login.example/x");
  });
});
