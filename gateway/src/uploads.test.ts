import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetLiveThreadCache } from "./threads.js";
import { assertImageMime, saveUpload, loadUpload, resolveAttachments, materializeAttachments } from "./uploads.js";

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

  it("allows text and log uploads and rejects binaries", async () => {
    const log = await saveUpload(Buffer.from("unit failed"), "text/plain", "app.log");
    expect(log.mime).toBe("text/plain");
    const named = await saveUpload(Buffer.from("{}"), "application/octet-stream", "notes.json");
    expect(named.mime).toBe("application/json");
    await expect(saveUpload(Buffer.from("MZ"), "application/octet-stream", "a.exe")).rejects.toThrow(/jpeg/);
    await expect(saveUpload(Buffer.from("a\0b"), "text/plain", "a.txt")).rejects.toThrow(/jpeg/);
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

  it("copies uploads into the workspace so sandbox cwd can read them", async () => {
    const att = await saveUpload(Buffer.from("png-bytes"), "image/png", "shot.png");
    const cwd = await mkdtemp(join(tmpdir(), "glassys-cwd-"));
    const files = await materializeAttachments(cwd, [att]);
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toContain(".glassys-uploads");
    expect(files[0]?.path.startsWith(cwd)).toBe(true);
    expect(files[0]?.body?.toString()).toBe("png-bytes");
    expect(await materializeAttachments(cwd, [{ id: "nope", mime: "image/png", name: "x.png" }])).toEqual([]);
  });

  it("garbage-collects unreferenced uploads after the TTL", async () => {
    const { gcUploads } = await import("./uploads.js");
    const att = await saveUpload(Buffer.from("png-bytes"), "image/png", "old.png");
    await gcUploads(Date.now() + 48 * 60 * 60 * 1000);
    expect(await loadUpload(att.id)).toBeNull();
  });

  it("garbage-collects orphan copies in the workspace upload dir", async () => {
    const { readdir, utimes, writeFile } = await import("node:fs/promises");
    const YAML = (await import("yaml")).default;
    const { defaultConfig } = await import("@glassys/protocol");
    const cwd = await mkdtemp(join(tmpdir(), "glassys-cwdup-"));
    const cfg = defaultConfig();
    cfg.agent.cwd = cwd;
    await writeFile(join(dir, "config.yaml"), YAML.stringify(cfg), "utf8");
    const att = await saveUpload(Buffer.from("png-bytes"), "image/png", "shot.png");
    await materializeAttachments(cwd, [att]);
    const copies = (await readdir(join(cwd, ".glassys-uploads"))).filter((n) => n !== ".gitignore");
    expect(copies.length).toBeGreaterThan(0);
    const dest = join(cwd, ".glassys-uploads", copies[0]!);
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await utimes(dest, old, old);
    const { gcUploads } = await import("./uploads.js");
    await gcUploads(Date.now());
    expect(await readdir(join(cwd, ".glassys-uploads"))).not.toContain(copies[0]);
  });
});
