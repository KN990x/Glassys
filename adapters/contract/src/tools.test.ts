import { describe, expect, it } from "vitest";
import { extractDiff, imagePartsFromAttachments, looksLikeDiff, promptWithAttachments, toolDenied, toolKindFromName } from "./tools.js";

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

  it("detects denied tool results", () => {
    expect(toolDenied("denied")).toBe(true);
    expect(toolDenied("completed", "Glassys denied this write")).toBe(true);
    expect(toolDenied("cancelled")).toBe(true);
    expect(toolDenied("completed")).toBe(false);
  });

  it("appends attachment paths to the user prompt", () => {
    expect(promptWithAttachments("hi", [{ path: "/tmp/a.png", mime: "image/png", name: "a.png" }])).toContain("/tmp/a.png");
    expect(promptWithAttachments("", [{ path: "/tmp/a.png", mime: "image/png", name: "a.png" }])).toContain("image(s)");
  });

  it("encodes native image parts from attachment bytes", () => {
    expect(imagePartsFromAttachments([{ mime: "image/png", name: "a.png", path: "/x" }])).toEqual([]);
    expect(imagePartsFromAttachments([{ mime: "image/png", name: "a.png", body: Buffer.from("hi") }])).toEqual([
      { mime: "image/png", name: "a.png", data: Buffer.from("hi").toString("base64") },
    ]);
  });
});
