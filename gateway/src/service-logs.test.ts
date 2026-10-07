import { mkdtemp, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SERVICE_LOG_KEEP_BYTES, SERVICE_LOG_MAX_BYTES, trimServiceLogs } from "./service-logs.js";

describe("trimServiceLogs", () => {
  it("cuts an oversized log to its tail at a line, and leaves small ones alone", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-logs-"));
    const line = `${"x".repeat(99)}\n`;
    const big = line.repeat(Math.ceil((SERVICE_LOG_MAX_BYTES + 1) / line.length)) + "last line\n";
    await writeFile(join(dir, "glassys.log"), big);
    await writeFile(join(dir, "glassys.err"), "small\n");
    await trimServiceLogs(dir);
    const size = (await stat(join(dir, "glassys.log"))).size;
    expect(size).toBeLessThanOrEqual(SERVICE_LOG_KEEP_BYTES);
    const kept = await readFile(join(dir, "glassys.log"), "utf8");
    expect(kept.endsWith("last line\n")).toBe(true);
    expect(kept.startsWith("x")).toBe(true);
    expect(await readFile(join(dir, "glassys.err"), "utf8")).toBe("small\n");
  });
});
