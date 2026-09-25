import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFileAtomic } from "./atomic.js";

describe("writeFileAtomic", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "glassys-atomic-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("survives concurrent writers to the same file and leaves no temp files", async () => {
    const target = join(dir, "state.json");
    await Promise.all(Array.from({ length: 20 }, (_, i) => writeFileAtomic(target, JSON.stringify({ i }))));
    expect(JSON.parse(await readFile(target, "utf8"))).toHaveProperty("i");
    expect(await readdir(dir)).toEqual(["state.json"]);
  });

  it("leaves nothing behind when the write fails", async () => {
    await expect(writeFileAtomic(join(dir, "missing", "state.json"), "{}")).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
  });
});
