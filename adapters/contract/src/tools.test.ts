import { describe, expect, it } from "vitest";
import { extractDiff, looksLikeDiff, toolKindFromName } from "./tools.js";

describe("extractDiff", () => {
  const sample = "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n";

  it("reads unified diffs from strings", () => {
    expect(looksLikeDiff(sample)).toBe(true);
    expect(extractDiff(sample).stats).toEqual({ add: 1, del: 1 });
  });

  it("reads diffString / patch fields", () => {
    expect(extractDiff({ diffString: sample }).diff).toBe(sample);
    expect(extractDiff({ result: { patch: sample } }).diff).toBe(sample);
  });

  it("maps list_dir after underscore stripping", () => {
    expect(toolKindFromName("list_dir")).toBe("ls");
    expect(toolKindFromName("listdir")).toBe("ls");
    expect(toolKindFromName("execute")).toBe("shell");
  });

  it("turns ACP spec diffs into unified diffs", () => {
    const found = extractDiff({
      type: "diff",
      path: "src/a.ts",
      oldText: "a",
      newText: "b",
    });
    expect(found.diff).toContain("--- a/src/a.ts");
    expect(found.diff).toContain("-a");
    expect(found.diff).toContain("+b");
    expect(
      extractDiff({
        content: [{ type: "diff", path: "f", oldText: "old", newText: "new" }],
      }).diff,
    ).toContain("+++ b/f");
  });
});
