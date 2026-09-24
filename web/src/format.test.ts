import { describe, expect, it } from "vitest";
import {
  blockMatchesQuery,
  cwdBasename,
  formatBytes,
  formatRelativeTime,
  formatUptime,
  groupThreadsByCwd,
  slashQuery,
} from "./format";

describe("format", () => {
  it("formats relative times", () => {
    const now = Date.parse("2026-01-02T00:00:00.000Z");
    expect(formatRelativeTime("2026-01-01T23:00:00.000Z", now, "en")).toMatch(/hour/i);
    expect(formatRelativeTime("not-a-date", now)).toBe("");
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
