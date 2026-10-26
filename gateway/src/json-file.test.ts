import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readJsonFile } from "./json-file.js";

describe("readJsonFile", () => {
  it("is undefined for a missing file and throws for a broken one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-json-"));
    await expect(readJsonFile(join(dir, "nope.json"))).resolves.toBeUndefined();
    await writeFile(join(dir, "bad.json"), '{"a": 1,}');
    await expect(readJsonFile(join(dir, "bad.json"))).rejects.toThrow(/not valid JSON/);
    await writeFile(join(dir, "ok.json"), '{"a": 1}');
    await expect(readJsonFile(join(dir, "ok.json"))).resolves.toEqual({ a: 1 });
  });
});

describe("a state file that cannot be parsed", () => {
  it("stops loadSecrets instead of regenerating over the operator's secrets", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-secrets-"));
    process.env.GLASSYS_DATA_DIR = dir;
    delete process.env.GLASSYS_JWT_SECRET;
    const { paths } = await import("./paths.js");
    const broken = '{"jwtSecret": "keep", "operatorPasswordHash": "scrypt$keep",}';
    await writeFile(paths.secrets(), broken);
    const { loadSecrets } = await import("./secrets.js");
    await expect(loadSecrets()).rejects.toThrow(/not valid JSON/);
    expect(await readFile(paths.secrets(), "utf8")).toBe(broken);
  });

  it("refuses a new schedule instead of writing it over the existing ones", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-sched-bad-"));
    process.env.GLASSYS_DATA_DIR = dir;
    const { paths } = await import("./paths.js");
    const broken = '{"jobs": [{"id": "a", "text": "nightly"},]}';
    await writeFile(paths.schedules(), broken);
    const { createSchedule } = await import("./schedules.js");
    await expect(createSchedule({ text: "x", cwd: dir, cron: "0 6 * * *" })).rejects.toThrow(/not valid JSON/);
    expect(await readFile(paths.schedules(), "utf8")).toBe(broken);
  });
});
