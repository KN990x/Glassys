import { describe, expect, it } from "vitest";
import { deriveActivity } from "./activity";
import type { Block } from "./transcript";

function tool(over: Partial<Extract<Block, { kind: "tool" }>>): Block {
  return {
    id: "t",
    kind: "tool",
    callId: "c",
    toolKind: "shell",
    title: "bash",
    status: "done",
    chunk: "",
    ...over,
  } as Block;
}

describe("deriveActivity", () => {
  it("lists commands with their outcome and output size", () => {
    const activity = deriveActivity([
      tool({ id: "a", command: "systemctl --failed", chunk: "one\ntwo\nthree" }),
      tool({ id: "b", command: "rm -rf /var/lib/pg", status: "denied" }),
      tool({ id: "c", toolKind: "read", path: "/etc/nginx/nginx.conf" }),
    ]);
    expect(activity.commands.map((c) => [c.command, c.status, c.lines])).toEqual([
      ["systemctl --failed", "done", 3],
      ["rm -rf /var/lib/pg", "denied", 0],
    ]);
  });

  it("folds repeated touches of one path and puts rewrites first", () => {
    const activity = deriveActivity([
      tool({ id: "a", toolKind: "read", path: "/etc/hosts" }),
      tool({ id: "b", toolKind: "read", path: "/etc/hosts" }),
      tool({
        id: "c",
        toolKind: "edit",
        path: "/etc/nginx/nginx.conf",
        stats: { add: 4, del: 2 },
        diff: "@@ -1 +1 @@\n-a\n+b",
      }),
    ]);
    expect(activity.files.map((f) => [f.path, f.changed, f.touches, f.add, f.del])).toEqual([
      ["/etc/nginx/nginx.conf", true, 1, 4, 2],
      ["/etc/hosts", false, 2, 0, 0],
    ]);
    /* The row scrolls to the most recent call for that path. */
    expect(activity.files[1]?.id).toBe("b");
    expect(activity.files[0]?.diff).toContain("+b");
  });

  it("totals the usage blocks the run emitted", () => {
    const activity = deriveActivity([
      { id: "u1", kind: "usage", inputTokens: 10, outputTokens: 2 },
      { id: "u2", kind: "usage", inputTokens: 5 },
    ]);
    expect(activity.usage).toEqual({ inputTokens: 15, outputTokens: 2 });
  });
});
