import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { DirListing, FilePreview, HostCapabilities, LogPage } from "@glassys/protocol";
import { I18nProvider } from "../../i18n";
import { FilesView, LogsView, type HostSource } from "./HostViews";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const caps: HostCapabilities = { overview: true, services: null, logs: "journald", files: true };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function page(message: string): LogPage {
  return { entries: [{ ts: Date.now(), priority: 6, message }] };
}

describe("LogsView", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("drops a reply for a unit the operator already left", async () => {
    const pending = new Map<string, ReturnType<typeof deferred<LogPage>>>();
    const source = {
      hostLogs: (p: { unit?: string }) => {
        const d = deferred<LogPage>();
        pending.set(p.unit ?? "", d);
        return d.promise;
      },
    } as unknown as HostSource;
    host = document.createElement("div");
    document.body.append(host);
    const render = (unit: string) =>
      root.render(
        <I18nProvider locale="en">
          <LogsView source={source} caps={caps} locale="en" unit={unit} onUnit={() => undefined} onDraft={() => undefined} />
        </I18nProvider>,
      );
    await act(async () => {
      root = createRoot(host);
      render("a.service");
    });
    await act(async () => render("b.service"));
    await act(async () => pending.get("b.service")!.resolve(page("from b")));
    await act(async () => pending.get("a.service")!.resolve(page("from a")));
    expect(host.textContent).toContain("from b");
    expect(host.textContent).not.toContain("from a");
  });

  it("asks the user journal for a user unit, and explains the lines picked even after new ones arrive", async () => {
    const asked: Array<{ unit?: string; scope?: string }> = [];
    const source = {
      hostLogs: async (p: { unit?: string; scope?: string }) => {
        asked.push(p);
        return page("first line");
      },
    } as unknown as HostSource;
    const drafts: string[] = [];
    host = document.createElement("div");
    document.body.append(host);
    await act(async () => {
      root = createRoot(host);
      root.render(
        <I18nProvider locale="en">
          <LogsView
            source={source}
            caps={caps}
            locale="en"
            unit="sync.service"
            scope="user"
            onUnit={() => undefined}
            onDraft={(text) => drafts.push(text)}
          />
        </I18nProvider>,
      );
    });
    expect(asked[0]).toMatchObject({ unit: "sync.service", scope: "user" });
    const line = host.querySelector('[role="option"]') as HTMLButtonElement;
    await act(async () => line.click());
    expect(line.getAttribute("aria-selected")).toBe("true");
    await act(async () => {
      [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Ask the agent"))!.click();
    });
    expect(drafts[0]).toContain("first line");
  });
});

describe("LogsView scrolling", () => {
  let root: Root;
  let host: HTMLDivElement;
  const proto = HTMLElement.prototype;
  const saved = {
    scrollHeight: Object.getOwnPropertyDescriptor(proto, "scrollHeight"),
    clientHeight: Object.getOwnPropertyDescriptor(proto, "clientHeight"),
  };

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    for (const [key, desc] of Object.entries(saved)) {
      if (desc) Object.defineProperty(proto, key, desc);
    }
  });

  it("opens on the newest line, which journalctl prints last", async () => {
    /* happy-dom does no layout: give the list a height and a taller content. */
    Object.defineProperty(proto, "scrollHeight", { configurable: true, get: () => 5000 });
    Object.defineProperty(proto, "clientHeight", { configurable: true, get: () => 400 });
    const source = { hostLogs: async () => page("newest") } as unknown as HostSource;
    host = document.createElement("div");
    document.body.append(host);
    await act(async () => {
      root = createRoot(host);
      root.render(
        <I18nProvider locale="en">
          <LogsView source={source} caps={caps} locale="en" unit="" onUnit={() => undefined} onDraft={() => undefined} />
        </I18nProvider>,
      );
    });
    await act(async () => Promise.resolve());
    expect((host.querySelector(".log-list") as HTMLDivElement).scrollTop).toBe(5000);
  });
});

describe("LogsView keyboard", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("is one tab stop and walks the lines with the arrows", async () => {
    const source = {
      hostLogs: async () => ({
        entries: ["one", "two", "three"].map((message, i) => ({ ts: Date.now() + i, priority: 6, message })),
      }),
    } as unknown as HostSource;
    host = document.createElement("div");
    document.body.append(host);
    await act(async () => {
      root = createRoot(host);
      root.render(
        <I18nProvider locale="en">
          <LogsView source={source} caps={caps} locale="en" unit="" onUnit={() => undefined} onDraft={() => undefined} />
        </I18nProvider>,
      );
    });
    const lines = () => [...host.querySelectorAll<HTMLButtonElement>('[role="option"]')];
    expect(lines().map((l) => l.tabIndex)).toEqual([-1, -1, 0]);
    lines()[2]!.focus();
    await act(async () => {
      lines()[2]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    });
    expect(document.activeElement?.textContent).toContain("two");
    expect(lines().map((l) => l.tabIndex)).toEqual([-1, 0, -1]);
  });
});

describe("FilesView", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("never shows the previous file's text under the next file's path", async () => {
    const listing: DirListing = {
      path: "/etc",
      parent: "/",
      truncated: false,
      entries: [
        { name: "a.conf", type: "file", size: 5, mtime: 0, mode: 0o644 },
        { name: "b.conf", type: "file", size: 4, mtime: 0, mode: 0o644 },
      ],
    };
    const files = new Map<string, ReturnType<typeof deferred<FilePreview>>>();
    const source = {
      hostFiles: async () => listing,
      hostFile: (path: string) => {
        const d = deferred<FilePreview>();
        files.set(path, d);
        return d.promise;
      },
    } as unknown as HostSource;
    host = document.createElement("div");
    document.body.append(host);
    await act(async () => {
      root = createRoot(host);
      root.render(
        <I18nProvider locale="en">
          <FilesView source={source} start="/etc" locale="en" onDraft={() => undefined} onMention={() => undefined} narrow={false} />
        </I18nProvider>,
      );
    });
    const row = (name: string) =>
      [...host.querySelectorAll<HTMLElement>("[title]")].find((el) => el.getAttribute("title") === `/etc/${name}`)!;
    await act(async () => row("a.conf").click());
    await act(async () => files.get("/etc/a.conf")!.resolve({ path: "/etc/a.conf", size: 5, binary: false, truncated: false, text: "alpha" }));
    expect(host.querySelector(".file-preview")?.textContent).toContain("alpha");
    await act(async () => row("b.conf").click());
    expect(host.querySelector(".file-preview")).toBeNull();
    await act(async () => files.get("/etc/b.conf")!.resolve({ path: "/etc/b.conf", size: 4, binary: false, truncated: false, text: "beta" }));
    expect(host.querySelector(".file-preview")?.textContent).toContain("beta");
  });
});
