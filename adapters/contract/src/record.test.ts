import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixtureRecorder } from "./record.js";

describe("fixtureRecorder", () => {
  it("is off unless GLASSYS_RECORD_FIXTURES names a directory", () => {
    expect(fixtureRecorder("x", {})).toBeNull();
  });

  it("writes each raw event as a JSONL line", () => {
    const dir = mkdtempSync(join(tmpdir(), "glassys-rec-"));
    const record = fixtureRecorder("cursor", { GLASSYS_RECORD_FIXTURES: dir })!;
    record({ type: "text-delta", text: "a" });
    record({ type: "tool-call-started", callId: "1" });
    const [file] = readdirSync(dir);
    expect(file).toMatch(/^cursor-.*\.jsonl$/);
    const lines = readFileSync(join(dir, file!), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toEqual([{ type: "text-delta", text: "a" }, { type: "tool-call-started", callId: "1" }]);
  });
});
