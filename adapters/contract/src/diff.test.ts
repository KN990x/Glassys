import { describe, expect, it } from "vitest";
import { diffStats, unifiedDiff } from "./diff.js";

describe("unifiedDiff", () => {
  it("shows a one-line edit as one changed line with context, not the whole file", () => {
    const old = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n");
    const next = old.replace("line 25", "line twenty-five");
    const diff = unifiedDiff("a.txt", old, next);
    expect(diffStats(diff)).toEqual({ add: 1, del: 1 });
    expect(diff).toContain("@@ -22,7 +22,7 @@");
    expect(diff).not.toContain(" line 1\n");
  });

  it("treats a missing old text as a new file without a stray deletion", () => {
    const diff = unifiedDiff("new.txt", null, "a\nb\n");
    expect(diff.startsWith("--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@")).toBe(true);
    expect(diffStats(diff)).toEqual({ add: 2, del: 0 });
  });

  it("writes an absolute path after the a/ b/ prefix without a double slash", () => {
    expect(unifiedDiff("/srv/app/x.conf", "a\n", "b\n").split("\n").slice(0, 2)).toEqual([
      "--- a/srv/app/x.conf",
      "+++ b/srv/app/x.conf",
    ]);
  });

  it("splits distant changes into separate hunks", () => {
    const old = Array.from({ length: 40 }, (_, i) => `l${i}`).join("\n");
    const next = old.replace("l2\n", "L2\n").replace("l35", "L35");
    const diff = unifiedDiff("f", old, next);
    expect(diff.match(/^@@/gm)).toHaveLength(2);
  });

  it("returns only headers when nothing changed", () => {
    expect(unifiedDiff("f", "same", "same")).toBe("--- a/f\n+++ b/f");
  });
});

describe("diffStats", () => {
  it("counts content lines that look like file headers", () => {
    const diff = "--- a/x.md\n+++ b/x.md\n@@ -1,2 +1,2 @@\n---- old rule\n+++ new heading\n context";
    expect(diffStats(diff)).toEqual({ add: 1, del: 1 });
  });
});
