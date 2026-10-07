import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { I18nProvider } from "../i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { setup } = vi.hoisted(() => ({ setup: vi.fn(async () => ({ token: "t" })) }));
vi.mock("../api", () => ({ api: { setup, saveConfig: vi.fn(async () => ({})) } }));

describe("Setup with a setup code", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    window.history.replaceState(null, "", "/");
  });

  it("takes the code from the installer's link, drops it from the address bar, and sends it", async () => {
    window.history.replaceState(null, "", "/?setup=K7QF2-M9XAB");
    const { Setup } = await import("./Setup");
    host = document.createElement("div");
    document.body.append(host);
    const done = vi.fn();
    await act(async () => {
      root = createRoot(host);
      root.render(
        <I18nProvider locale="en">
          <Setup locale="en" onLocale={() => undefined} needsCode onDone={done} />
        </I18nProvider>,
      );
    });
    expect(window.location.search).toBe("");
    const [code, password, confirm] = [...host.querySelectorAll("input")];
    expect(code!.value).toBe("K7QF2-M9XAB");
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      for (const el of [password!, confirm!]) {
        set.call(el, "correct horse battery");
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(setup).toHaveBeenCalledWith("correct horse battery", "K7QF2-M9XAB");
    expect(done).toHaveBeenCalled();
  });
});
