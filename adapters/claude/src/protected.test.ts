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
});
