import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commandTouchesProtectedPath, isProtectedPath } from "./protected.js";

const home = homedir();
const data = join(home, "glassys", "data");

describe("isProtectedPath", () => {
  it("matches absolute, home-relative and cwd-relative paths inside a protected dir", () => {
    expect(isProtectedPath(join(data, "secrets.json"), home, [data])).toBe(true);
    expect(isProtectedPath("~/glassys/data/secrets.json", "/", [data])).toBe(true);
    expect(isProtectedPath("glassys/data", home, [data])).toBe(true);
    expect(isProtectedPath("glassys/../glassys/data/x", home, [data])).toBe(true);
  });

  it("leaves everything else alone", () => {
    expect(isProtectedPath(join(home, "glassys", "data2"), home, [data])).toBe(false);
    expect(isProtectedPath(join(home, "stacks", ".env"), home, [data])).toBe(false);
    expect(isProtectedPath(join(data, "x"), home, [])).toBe(false);
    expect(isProtectedPath(join(data, "x"), home, undefined)).toBe(false);
  });
});

describe("commandTouchesProtectedPath", () => {
  it("catches the plain ways of naming the data dir", () => {
    expect(commandTouchesProtectedPath(`cat ${data}/secrets.json`, home, [data])).toBe(true);
    expect(commandTouchesProtectedPath("cat ~/glassys/data/secrets.json", "/", [data])).toBe(true);
    expect(commandTouchesProtectedPath("cat glassys/data/secrets.json", home, [data])).toBe(true);
    expect(commandTouchesProtectedPath('grep -r key "./glassys/data"', home, [data])).toBe(true);
  });

  it("does not trip on lookalikes", () => {
    expect(commandTouchesProtectedPath("cat glassys/data2/x", home, [data])).toBe(false);
    expect(commandTouchesProtectedPath("cat myglassys/data/x", home, [data])).toBe(false);
    expect(commandTouchesProtectedPath("docker compose ps", home, [data])).toBe(false);
  });

  it("treats a one-segment name as a path only when it is used as one", () => {
    const clone = join(home, "glassys");
    expect(commandTouchesProtectedPath("docker logs data", clone, [data])).toBe(false);
    expect(commandTouchesProtectedPath("cat data/secrets.json", clone, [data])).toBe(true);
    expect(commandTouchesProtectedPath("ls ./data", clone, [data])).toBe(true);
  });
});
