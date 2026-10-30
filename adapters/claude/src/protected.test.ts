import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claudeToolTouchesProtected } from "./index.js";

const home = homedir();
const data = join(home, "glassys", "data");

describe("claudeToolTouchesProtected", () => {
  it("denies file tools aimed at the data dir", () => {
    expect(claudeToolTouchesProtected("Read", { file_path: join(data, "secrets.json") }, home, [data])).toBe(true);
    expect(claudeToolTouchesProtected("Edit", { file_path: "glassys/data/config.yaml" }, home, [data])).toBe(true);
    expect(claudeToolTouchesProtected("Grep", { pattern: "key", path: data }, home, [data])).toBe(true);
    expect(claudeToolTouchesProtected("Glob", { pattern: "glassys/data/**/*.json" }, home, [data])).toBe(true);
    expect(claudeToolTouchesProtected("Bash", { command: "cat ~/glassys/data/secrets.json" }, home, [data])).toBe(true);
  });

  it("leaves ordinary systems work alone", () => {
    expect(claudeToolTouchesProtected("Read", { file_path: join(home, "stacks", "proxy", ".env") }, home, [data])).toBe(false);
    expect(claudeToolTouchesProtected("Grep", { pattern: "error" }, home, [data])).toBe(false);
    expect(claudeToolTouchesProtected("Bash", { command: "docker compose ps" }, home, [data])).toBe(false);
    expect(claudeToolTouchesProtected("Read", { file_path: join(data, "x") }, home, [])).toBe(false);
  });

  it("reads a Glob pattern up to its first wildcard, in linear time", () => {
    expect(claudeToolTouchesProtected("Glob", { pattern: "glassys/data" }, home, [data])).toBe(true);
    expect(claudeToolTouchesProtected("Glob", { pattern: "stacks/*/compose.yaml" }, home, [data])).toBe(false);
    const started = performance.now();
    expect(claudeToolTouchesProtected("Glob", { pattern: `${"*".repeat(50_000)}\n` }, home, [data])).toBe(false);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
