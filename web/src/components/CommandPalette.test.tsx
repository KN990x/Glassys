import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { I18nProvider } from "../i18n";
import { CommandPalette, filterPaletteItems, type PaletteItem } from "./CommandPalette";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("CommandPalette filter", () => {
  const items: PaletteItem[] = [
    { id: "new", group: "product", label: "New thread", run: () => undefined },
    { id: "tpl:status", group: "template", label: "Host status", hint: "/status", run: () => undefined },
  ];

  it("filters by label, hint, and id", () => {
    expect(filterPaletteItems(items, "status").map((i) => i.id)).toEqual(["tpl:status"]);
    expect(filterPaletteItems(items, "thread").map((i) => i.id)).toEqual(["new"]);
    expect(filterPaletteItems(items, "")).toHaveLength(2);
  });
});

describe("CommandPalette groups", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("paints group headers and keeps selection when item ids are unchanged", async () => {
    host = document.createElement("div");
    document.body.append(host);
    const items: PaletteItem[] = [
      { id: "new", group: "product", label: "New thread", run: () => undefined },
      { id: "cwd:/opt", group: "workspace", label: "opt", hint: "/opt", run: () => undefined },
      { id: "tpl:status", group: "template", label: "Host status", hint: "/status", run: () => undefined },
    ];
    await act(async () => {
      root = createRoot(host);
      root.render(
        <I18nProvider locale="en">
          <CommandPalette open query="" items={items} onClose={() => undefined} />
        </I18nProvider>,
      );
    });
    expect(host.textContent).toContain("Commands");
    expect(host.textContent).toContain("Workspaces");
    expect(host.textContent).toContain("Ops templates");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(host.querySelector("button.current")?.textContent).toContain("Host status");
    const nextItems = items.map((item) => ({ ...item }));
    await act(async () => {
      root.render(
        <I18nProvider locale="en">
          <CommandPalette open query="" items={nextItems} onClose={() => undefined} />
        </I18nProvider>,
      );
    });
    expect(host.querySelector("button.current")?.textContent).toContain("Host status");
  });

  it("points the input at the active option and keeps Tab inside", async () => {
    host = document.createElement("div");
    document.body.append(host);
    const items: PaletteItem[] = [
      { id: "new", group: "product", label: "New thread", run: () => undefined },
      { id: "tpl:status", group: "template", label: "Host status", run: () => undefined },
    ];
    await act(async () => {
      root = createRoot(host);
      root.render(
        <I18nProvider locale="en">
          <CommandPalette open query="" items={items} onClose={() => undefined} onQuery={() => undefined} />
        </I18nProvider>,
      );
    });
    const input = host.querySelector<HTMLInputElement>('input[role="combobox"]');
    expect(input).not.toBeNull();
    const first = host.querySelector('[role="option"][aria-selected="true"]');
    expect(input?.getAttribute("aria-activedescendant")).toBe(first?.id);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    const second = host.querySelector('[role="option"][aria-selected="true"]');
    expect(second?.textContent).toContain("Host status");
    expect(input?.getAttribute("aria-activedescendant")).toBe(second?.id);
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    await act(async () => {
      window.dispatchEvent(tab);
    });
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
  });
});
