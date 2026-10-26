import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { PopAnchor, Popover } from "./Popover";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Popover as a menu", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("is announced as a menu and moves between enabled items with the arrows, Home and End", async () => {
    host = document.createElement("div");
    document.body.append(host);
    await act(async () => {
      root = createRoot(host);
      root.render(
        <PopAnchor>
          <Popover open onClose={() => undefined} label="More" menu>
            <button type="button" role="menuitem">Rename</button>
            <button type="button" role="menuitem" disabled>
              Export
            </button>
            <button type="button" role="menuitem">Delete</button>
          </Popover>
        </PopAnchor>,
      );
    });
    const menu = host.querySelector('[role="menu"]') as HTMLElement;
    expect(menu).toBeTruthy();
    const [rename, , del] = [...host.querySelectorAll("button")];
    expect(document.activeElement).toBe(rename);
    const press = (key: string) =>
      act(() => {
        (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      });
    press("ArrowDown");
    expect(document.activeElement).toBe(del);
    press("ArrowDown");
    expect(document.activeElement).toBe(rename);
    press("End");
    expect(document.activeElement).toBe(del);
    press("Home");
    expect(document.activeElement).toBe(rename);
    press("ArrowUp");
    expect(document.activeElement).toBe(del);
  });
});
