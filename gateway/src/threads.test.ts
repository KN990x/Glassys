import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultConfig } from "@glassys/protocol";
import { paths } from "./paths.js";
import { resetLiveThreadCache, ensureLiveThread, listThreads } from "./threads.js";

describe("threads store", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "glassys-th-"));
    process.env.GLASSYS_DATA_DIR = dir;
    resetLiveThreadCache();
    const cfg = defaultConfig();
    cfg.agent.cwd = dir;
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "config.yaml"), YAML.stringify(cfg), "utf8");
    await writeFile(join(dir, "state.json"), JSON.stringify({ profileId: "default", agentId: null }), "utf8");
  });

  afterEach(() => {
    resetLiveThreadCache();
  });

  it("migrates a legacy transcript.jsonl into a live thread", async () => {
    await writeFile(
      paths.legacyTranscript(),
      `${JSON.stringify({ type: "user.message", text: "hello from legacy" })}\n`,
      "utf8",
    );
    const id = await ensureLiveThread();
    expect(id).toBeTruthy();
    const listed = await listThreads();
    expect(listed[0]?.id).toBe(id);
    expect(listed[0]?.title).toContain("hello from legacy");
  });

  it("refuses to delete a missing thread id", async () => {
    await ensureLiveThread();
    const { removeThread } = await import("./threads.js");
    await expect(removeThread("missing")).rejects.toThrow(/not found/);
  });

  it("keeps a manual title when the first message would refresh it", async () => {
    const id = await ensureLiveThread();
    const { renameThread, refreshLiveTitle, listThreads } = await import("./threads.js");
    await renameThread(id, "Ops box");
    await writeFile(
      paths.threadTranscript(id),
      `${JSON.stringify({ type: "user.message", text: "hello from ops" })}\n`,
      "utf8",
    );
    await refreshLiveTitle();
    expect((await listThreads()).find((t) => t.id === id)?.title).toBe("Ops box");
  });

  it("keeps a manual title when the live thread is archived", async () => {
    const id = await ensureLiveThread();
    const { renameThread, archiveLiveThread, listThreads } = await import("./threads.js");
    await renameThread(id, "Ops box");
    await writeFile(
      paths.threadTranscript(id),
      `${JSON.stringify({ type: "user.message", text: "hello from ops" })}\n`,
      "utf8",
    );
    await archiveLiveThread(null);
    expect((await listThreads()).find((t) => t.id === id)?.title).toBe("Ops box");
  });

  async function setCwd(cwd: string) {
    const cfg = defaultConfig();
    cfg.agent.cwd = cwd;
    await writeFile(join(dir, "config.yaml"), YAML.stringify(cfg), "utf8");
  }

  it("keeps one thread when a config change rotates before the first run", async () => {
    const { rotateLiveThread } = await import("./threads.js");
    const id = await ensureLiveThread();
    const etc = join(dir, "etc");
    await mkdir(etc);
    await setCwd(etc);
    const meta = await rotateLiveThread(null, { ...defaultConfig().agent, cwd: dir });
    expect(meta.id).toBe(id);
    const listed = await listThreads();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.cwd).toBe(etc);
    expect(listed[0]?.title).toBe("etc");
  });

  it("archives a thread that ran under the config it ran under", async () => {
    const { rotateLiveThread } = await import("./threads.js");
    const id = await ensureLiveThread();
    await writeFile(paths.threadTranscript(id), `${JSON.stringify({ type: "user.message", text: "df -h" })}\n`, "utf8");
    const etc = join(dir, "etc");
    await mkdir(etc);
    await setCwd(etc);
    const fresh = await rotateLiveThread(null, { ...defaultConfig().agent, cwd: dir });
    expect(fresh.id).not.toBe(id);
    const archived = (await listThreads()).find((t) => t.id === id);
    expect(archived?.cwd).toBe(dir);
    expect(archived?.title).toContain("df -h");
  });

  it("reuses an empty live thread for New thread, unless it must be fresh", async () => {
    const { startNewThread } = await import("./threads.js");
    const id = await ensureLiveThread();
    expect((await startNewThread(null)).id).toBe(id);
    expect(await listThreads()).toHaveLength(1);
    const fresh = await startNewThread(null, { fresh: true });
    expect(fresh.id).not.toBe(id);
  });
});
