import { describe, expect, it } from "vitest";
import { isMessageId } from "@glassys/protocol";
import {
  newMessageId,
  blockMatchesQuery,
  cwdBasename,
  formatBytes,
  formatRelativeShort,
  formatUptime,
  groupThreadsByCwd,
  slashQuery,
} from "./format";

describe("format", () => {
  it("formats compact relative ages", () => {
    const now = Date.parse("2026-01-02T00:00:00.000Z");
    expect(formatRelativeShort("2026-01-01T23:00:00.000Z", now, "en")).toBe("1h");
    expect(formatRelativeShort("2026-01-01T23:59:50.000Z", now, "es")).toBe("ahora");
    expect(formatRelativeShort("not-a-date", now)).toBe("");
  });

  it("groups threads by cwd in first-seen order", () => {
    const groups = groupThreadsByCwd([
      { id: "a", title: "one", adapter: "cursor", cwd: "/opt/a", updatedAt: "1" },
      { id: "b", title: "two", adapter: "cursor", cwd: "/opt/b", updatedAt: "2" },
      { id: "c", title: "three", adapter: "claude", cwd: "/opt/a", updatedAt: "3" },
    ]);
    expect(groups.map((g) => g.cwd)).toEqual(["/opt/a", "/opt/b"]);
    expect(groups[0]?.threads.map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("takes the last path segment", () => {
    expect(cwdBasename("/opt/stack/")).toBe("stack");
    expect(cwdBasename("")).toBe("");
  });

  it("filters transcript blocks by query", () => {
    expect(blockMatchesQuery({ kind: "user", text: "restart nginx" }, "nginx")).toBe(true);
    expect(blockMatchesQuery({ kind: "tool", title: "bash", command: "systemctl status" }, "nginx")).toBe(false);
  });

  it("only treats a leading slash as a palette query", () => {
    expect(slashQuery("/status")).toBe("status");
    expect(slashQuery("hello /status")).toBeNull();
    expect(slashQuery("/status\nmore")).toBeNull();
  });
});


describe("host formats", () => {
  it("formats bytes in binary units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(6.2 * 1024 ** 3)).toBe("6.2 GB");
    expect(formatBytes(120 * 1024 ** 3)).toBe("120 GB");
  });

  it("formats uptime with the two largest units", () => {
    expect(formatUptime(45 * 60)).toBe("45m");
    expect(formatUptime(3 * 3600 + 20 * 60)).toBe("3h 20m");
    expect(formatUptime(12 * 86400 + 4 * 3600)).toBe("12d 4h");
  });
});

describe("newMessageId", () => {
  it("makes a gateway-valid v4 UUID without randomUUID (plain HTTP on a LAN address)", () => {
    const insecure = { getRandomValues: <T extends ArrayBufferView>(a: T) => crypto.getRandomValues(a as never) as T };
    const ids = new Set(Array.from({ length: 50 }, () => newMessageId(insecure as never)));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(isMessageId(id)).toBe(true);
  });
});

describe("qrPath", () => {
  it("draws every dark module once, merged into runs", async () => {
    const { qrPath } = await import("./components/QrCode");
    const { encode } = await import("uqr");
    const value = "http://192.168.1.20:8787";
    const { size, d } = qrPath(value);
    const qr = encode(value, { ecc: "L" });
    const flat = (qr.data as boolean[][]).flat();
    const dark = flat.filter(Boolean).length;
    const drawn = [...d.matchAll(/h(\d+)v1/g)].reduce((n, m) => n + Number(m[1]), 0);
    expect(size).toBe(qr.size);
    expect(drawn).toBe(dark);
  });
});
