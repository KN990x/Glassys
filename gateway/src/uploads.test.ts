import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetLiveThreadCache } from "./threads.js";
import { assertImageMime, saveUpload, loadUpload, resolveAttachments } from "./uploads.js";

describe("uploads", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "glassys-up-"));
    process.env.GLASSYS_DATA_DIR = dir;
    resetLiveThreadCache();
  });

  afterEach(() => {
    resetLiveThreadCache();
  });

  it("only allows image mime types under 4MB", () => {
    expect(assertImageMime("image/png")).toBe("image/png");
    expect(assertImageMime("image/jpg")).toBe("image/jpeg");
    expect(() => assertImageMime("application/pdf")).toThrow(/jpeg/);
  });

  it("stores bytes off the transcript and resolves them by id", async () => {
    const att = await saveUpload(Buffer.from("png-bytes"), "image/png", "shot.png");
    expect(att.mime).toBe("image/png");
    const stored = await loadUpload(att.id);
    expect(stored?.path).toContain(join("uploads", att.id));
    const files = await resolveAttachments([att]);
    expect(files[0]?.path).toBe(stored?.path);
    expect(await loadUpload("../secret")).toBeNull();
  });
});
