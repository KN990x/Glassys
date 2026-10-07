import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, useState } from "react";
import { SegmentedControl } from "./SegmentedControl";
import { Popover, PopAnchor } from "./Popover";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function mount(node: React.ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  act(() => {
    root = createRoot(host);
    root.render(node);
  });
}

describe("SegmentedControl", () => {
  it("is one tab stop and moves the choice with the arrow keys", () => {
    function Harness() {
      const [v, setV] = useState<"a" | "b" | "c">("a");
      return (
        <SegmentedControl
          label="pick"
          value={v}
          onChange={setV}
          options={[
            { value: "a", label: "A" },
            { value: "b", label: "B" },
            { value: "c", label: "C" },
          ]}
        />
      );
    }
    mount(<Harness />);
    const radios = () => [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(radios().map((r) => r.tabIndex)).toEqual([0, -1, -1]);
    act(() => {
      radios()[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });
    expect(radios().map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "false", "true"]);
    expect(document.activeElement).toBe(radios()[2]);
  });
});

describe("Popover", () => {
  it("moves focus in when it opens and back to its opener when it closes", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <PopAnchor>
          <button type="button" id="opener" onClick={() => setOpen(true)}>
            open
          </button>
          <Popover open={open} onClose={() => setOpen(false)} label="menu">
            <button type="button" id="item">
              item
            </button>
          </Popover>
        </PopAnchor>
      );
    }
    mount(<Harness />);
    const opener = host.querySelector<HTMLButtonElement>("#opener")!;
    opener.focus();
    act(() => opener.click());
    expect(document.activeElement?.id).toBe("item");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(host.querySelector("#item")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
