import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, useRef } from "react";
import { useDialogFocus } from "./useDialogFocus";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Sheet({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, onClose);
  return (
    <div ref={ref} role="dialog">
      <button type="button">first</button>
      <button type="button">last</button>
    </div>
  );
}

describe("useDialogFocus", () => {
  let root: Root;
  let host: HTMLDivElement;
  let opener: HTMLButtonElement;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    opener.remove();
  });

  async function open(onClose: () => void) {
    opener = document.createElement("button");
    opener.textContent = "open";
    document.body.append(opener);
    opener.focus();
    host = document.createElement("div");
    document.body.append(host);
    await act(async () => {
      root = createRoot(host);
      root.render(<Sheet onClose={onClose} />);
    });
  }

  it("moves focus in and wraps Tab at the edges", async () => {
    await open(() => undefined);
    const [first, last] = host.querySelectorAll("button");
    expect(document.activeElement).toBe(first);
    last!.focus();
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    last!.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
  });

  it("takes Escape before window listeners such as cancel-the-run", async () => {
    const onClose = vi.fn();
    const onWindow = vi.fn();
    window.addEventListener("keydown", onWindow);
    await open(onClose);
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    window.removeEventListener("keydown", onWindow);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onWindow).not.toHaveBeenCalled();
  });

  it("hands focus back to the opener on close", async () => {
    await open(() => undefined);
    await act(async () => root.render(<></>));
    expect(document.activeElement).toBe(opener);
  });
});
