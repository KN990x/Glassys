import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hostCapabilities, hostOverview, listServices, readLogs } from "./host-probe.js";

/*
 * The probes against the real machine, not fixtures. On a systemd host — the
 * Ubuntu CI runner — this runs systemctl --output=json and journalctl -o json
 * for real, which the parser tests can only imitate. Elsewhere it is skipped.
 */
const systemd = process.platform === "linux" && existsSync("/run/systemd/system");
const macos = process.platform === "darwin";

describe.skipIf(!systemd)("host probes on a live systemd host", () => {
  it("finds systemd and the journal", async () => {
    expect(await hostCapabilities()).toMatchObject({ services: "systemd", logs: "journald" });
  });

  it("lists real units", async () => {
    const units = await listServices("system", "all");
    expect(units.length).toBeGreaterThan(0);
    for (const u of units) {
      expect(u.name).toMatch(/\.service$/);
      expect(u.active).toBeTruthy();
    }
    const active = await listServices("system", "active");
    expect(active.every((u) => u.active === "active")).toBe(true);
  });

  it("reads the journal and pages from its cursor", async () => {
    const page = await readLogs({ lines: 20 });
    expect(Array.isArray(page.entries)).toBe(true);
    for (const e of page.entries) {
      expect(e.ts).toBeGreaterThan(0);
      expect(e.priority).toBeGreaterThanOrEqual(0);
      expect(e.priority).toBeLessThanOrEqual(7);
    }
    if (page.cursor) {
      const next = await readLogs({ lines: 20, cursor: page.cursor });
      expect(next.cursor).toBeTruthy();
    }
  });

  it("reports the root filesystem and plausible memory", async () => {
    const o = await hostOverview();
    expect(o.disks.some((d) => d.mount === "/")).toBe(true);
    expect(o.mem.total).toBeGreaterThan(0);
    expect(o.mem.used).toBeGreaterThan(0);
    expect(o.mem.used).toBeLessThanOrEqual(o.mem.total);
  });
});

describe.skipIf(!macos)("host probes on a live macOS host", () => {
  it("lists launchd jobs without counting reaped agents as failures", async () => {
    expect((await hostCapabilities()).services).toBe("launchd");
    const units = await listServices("system", "all");
    expect(units.length).toBeGreaterThan(0);
    expect(units.filter((u) => u.active === "failed").every((u) => /^exit [1-9]/.test(u.sub))).toBe(true);
  });

  it("measures memory with the file cache counted as available", async () => {
    const o = await hostOverview();
    expect(o.disks.some((d) => d.mount === "/")).toBe(true);
    expect(o.disks.some((d) => d.mount.startsWith("/Library/Developer/"))).toBe(false);
    expect(o.mem.used).toBeLessThan(o.mem.total);
  });
});
