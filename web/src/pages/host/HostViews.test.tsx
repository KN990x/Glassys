import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { I18nProvider } from "../../i18n";
import { HostViews, LogsView, MAX_LOG_ROWS, type HostSource } from "./HostViews";
import type { LogEntry } from "@glassys/protocol";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GB = 1024 ** 3;
const source: HostSource = {
  hostOverview: async () => ({
    hostname: "web-01",
    os: "Debian GNU/Linux 12",
    kernel: "6.1.0",
    arch: "x64",
    uptimeSec: 3600,
    load: [0.5, 0.4, 0.3],
    cpus: 4,
    mem: { total: 8 * GB, used: 2 * GB },
    disks: [{ mount: "/", fs: "/dev/sda1", size: 50 * GB, used: 47 * GB }],
  }),
  hostServices: async (_scope, state) => ({
    units: [
      { name: "backup.service", description: "Nightly backup", load: "loaded", active: "failed", sub: "failed" },
      { name: "caddy.service", description: "Caddy", load: "loaded", active: "active", sub: "running" },
    ].filter((u) => state === "all" || (state === "failed" ? u.active === "failed" : u.active === "active")),
  }),
  hostLogs: async () => ({ entries: [], cursor: "c" }),
  hostFiles: async (path) => ({ path, parent: null, truncated: false, entries: [] }),
  hostFile: async (path) => ({ path, size: 0, binary: false, truncated: false, text: "" }),
};

const caps = { overview: true, services: "systemd", logs: "journald", files: true } as const;

describe("HostViews", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  async function render(view: "overview" | "services", onDraft = vi.fn()) {
    host = document.createElement("div");
    document.body.append(host);
    await act(async () => {
      root = createRoot(host);
      root.render(
        <I18nProvider locale="en">
          <HostViews
            view={view}
            onView={() => undefined}
            caps={caps}
            source={source}
            locale="en"
            cwd="/etc"
            narrow={false}
            onDraft={onDraft}
            onMention={() => undefined}
          />
        </I18nProvider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    return onDraft;
  }

  it("shows the machine's figures and only the failed units", async () => {
    await render("overview");
    expect(host.textContent).toContain("web-01");
    expect(host.textContent).toContain("94%");
    expect(host.textContent).toContain("backup.service");
    expect(host.textContent).not.toContain("caddy.service");
  });

  it("drafts a prompt instead of acting on a unit", async () => {
    const onDraft = await render("services");
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Restart")).toBe(false);
    const row = [...host.querySelectorAll(".unit-row .list-row-main")].find((b) => b.textContent?.includes("backup.service"));
    await act(async () => (row as HTMLButtonElement).click());
    const restart = [...host.querySelectorAll("button")].find((b) => b.textContent === "Restart");
    await act(async () => restart?.click());
    expect(onDraft).toHaveBeenCalledWith(expect.stringContaining("Restart backup.service"));
  });
});

describe("LogsView", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  const line = (i: number, priority = 6): LogEntry => ({ ts: 1_700_000_000_000 + i * 1000, priority, unit: "caddy.service", message: `line ${i}` });

  function logSource(pages: Array<{ entries: LogEntry[]; cursor?: string }>) {
    const hostLogs = vi.fn(async (_query: Parameters<HostSource["hostLogs"]>[0]) => pages.shift() ?? { entries: [], cursor: "end" });
    const src: HostSource = { ...source, hostLogs };
    return { src, hostLogs };
  }

  async function render(src: HostSource, opts: { logs?: "journald" | null; onDraft?: (text: string) => void } = {}) {
    host = document.createElement("div");
    document.body.append(host);
    await act(async () => {
      root = createRoot(host);
      root.render(
        <I18nProvider locale="en">
          <LogsView
            source={src}
            caps={{ ...caps, logs: opts.logs === undefined ? "journald" : opts.logs }}
            locale="en"
            unit=""
            onUnit={() => undefined}
            onDraft={opts.onDraft ?? (() => undefined)}
          />
        </I18nProvider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  const messages = () => [...host.querySelectorAll(".log-msg")].map((el) => el.textContent);

  it("follows the journal from its cursor and appends what is new", async () => {
    vi.useFakeTimers();
    const { src, hostLogs } = logSource([
      { entries: [line(1)], cursor: "c1" },
      { entries: [line(2)], cursor: "c2" },
    ]);
    await render(src);
    expect(messages()).toEqual(["line 1"]);
    await act(async () => (host.querySelector('[role="switch"]') as HTMLButtonElement).click());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(hostLogs).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "c1" }));
    expect(messages()).toEqual(["line 1", "line 2"]);
  });

  it("keeps at most MAX_LOG_ROWS lines while following", async () => {
    vi.useFakeTimers();
    const burst = Array.from({ length: MAX_LOG_ROWS + 1000 }, (_, i) => line(i + 2));
    const { src } = logSource([{ entries: [line(1)], cursor: "c1" }, { entries: burst, cursor: "c2" }]);
    await render(src);
    await act(async () => (host.querySelector('[role="switch"]') as HTMLButtonElement).click());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(host.querySelectorAll(".log-line")).toHaveLength(MAX_LOG_ROWS);
    expect(messages().at(-1)).toBe(`line ${MAX_LOG_ROWS + 1001}`);
  });

  it("drafts the selected lines for the agent", async () => {
    const onDraft = vi.fn();
    const { src } = logSource([{ entries: [line(1, 3), line(2), line(3, 4)], cursor: "c1" }]);
    await render(src, { onDraft });
    const lines = [...host.querySelectorAll(".log-line")] as HTMLButtonElement[];
    await act(async () => {
      lines[0]!.click();
      lines[2]!.click();
    });
    expect(host.querySelector(".selection-bar")?.textContent).toContain("2 selected");
    const ask = [...host.querySelectorAll(".selection-bar button")].find((b) => b.textContent?.includes("Ask the agent"));
    await act(async () => (ask as HTMLButtonElement).click());
    const text = onDraft.mock.calls[0]![0] as string;
    expect(text).toContain("line 1");
    expect(text).toContain("line 3");
    expect(text).not.toContain("line 2");
    expect(text).toContain("```");
  });

  it("reloads without a cursor when the priority changes", async () => {
    const { src, hostLogs } = logSource([
      { entries: [line(1)], cursor: "c1" },
      { entries: [line(5, 3)], cursor: "c9" },
    ]);
    await render(src);
    const errors = [...host.querySelectorAll(".segment")].find((b) => b.textContent === "Errors");
    await act(async () => (errors as HTMLButtonElement).click());
    await act(async () => {
      await Promise.resolve();
    });
    expect(hostLogs).toHaveBeenLastCalledWith(expect.objectContaining({ priority: "err" }));
    expect(hostLogs.mock.calls.at(-1)![0]).not.toHaveProperty("cursor");
    expect(messages()).toEqual(["line 5"]);
  });

  it("says so and asks nothing when the host has no journal", async () => {
    const { src, hostLogs } = logSource([]);
    await render(src, { logs: null });
    expect(host.textContent).toContain("No systemd journal was found on this host.");
    expect(hostLogs).not.toHaveBeenCalled();
  });
});
