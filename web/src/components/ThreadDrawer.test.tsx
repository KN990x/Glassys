import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { I18nProvider } from "../i18n";
import { ThreadDrawer } from "./ThreadDrawer";
import type { ThreadSummary } from "@glassys/protocol";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const threads: ThreadSummary[] = [
  {
    id: "t1",
    title: "Live",
    adapter: "cursor",
    cwd: "/opt/stack",
    updatedAt: new Date().toISOString(),
  },
  {
    id: "t2",
    title: "Old",
    adapter: "claude",
    cwd: "/opt/stack",
    updatedAt: new Date().toISOString(),
  },
];

describe("ThreadDrawer", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.body.style.overflow = "";
  });

  it("shows cwd, git context, and disables new while busy", async () => {
    host = document.createElement("div");
    document.body.append(host);
    await act(async () => {
      root = createRoot(host);
      root.render(
        <I18nProvider locale="en">
          <ThreadDrawer
            threads={threads}
            currentId="t1"
            locale="en"
            busy
            waiting={false}
            onNew={() => undefined}
            onSwitch={() => undefined}
            onDelete={() => undefined}
            onRename={async () => undefined}
            onClose={() => undefined}
            git={{ branch: "main", dirty: true }}
            currentCwd="/opt/stack"
            pins={["/opt/pinned"]}
            recents={["/opt/stack", "/tmp/old"]}
            onOpenCwd={() => undefined}
            onPin={() => undefined}
            onUnpin={() => undefined}
          />
        </I18nProvider>,
      );
    });
    expect(host.textContent).toContain("/opt/stack");
    expect(host.textContent).toContain("main");
    expect(host.textContent).toContain("dirty");
    expect(host.textContent).toContain("/opt/pinned");
    expect(host.querySelector("button.primary")?.hasAttribute("disabled")).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("filters threads by title", async () => {
    host = document.createElement("div");
    document.body.append(host);
    await act(async () => {
      root = createRoot(host);
      root.render(
        <I18nProvider locale="en">
          <ThreadDrawer
            threads={threads}
            currentId="t1"
            locale="en"
            busy={false}
            waiting={false}
            onNew={() => undefined}
            onSwitch={() => undefined}
            onDelete={() => undefined}
            onRename={async () => undefined}
            onClose={() => undefined}
            onExport={() => undefined}
          />
        </I18nProvider>,
      );
    });
    expect(host.textContent).toContain("Live");
    expect(host.textContent).toContain("Old");
    const search = host.querySelector('input[type="search"]') as HTMLInputElement;
    await act(async () => {
      const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      proto?.set?.call(search, "old");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const titles = [...host.querySelectorAll(".thread-list .picker-item strong")].map((el) => el.textContent);
    expect(titles).toEqual(["Old"]);
  });
});
