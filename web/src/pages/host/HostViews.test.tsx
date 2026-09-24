import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { I18nProvider } from "../../i18n";
import { HostViews, type HostSource } from "./HostViews";

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
    const restart = [...host.querySelectorAll("button")].find((b) => b.textContent === "Restart");
    await act(async () => restart?.click());
    expect(onDraft).toHaveBeenCalledWith(expect.stringContaining("Restart backup.service"));
  });
});
