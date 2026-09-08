import { describe, expect, it } from "vitest";
import { blockMatchesQuery, cwdBasename, formatRelativeTime, groupThreadsByCwd } from "./format";

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
});
