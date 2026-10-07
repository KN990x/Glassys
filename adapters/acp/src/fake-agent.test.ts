import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ServerMessage } from "@glassys/protocol";
import { acpAdapter } from "./index.js";

/* The same agent an operator can pick in the wizard to try Glassys without an account. */
const FAKE_AGENT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../scripts/fake-acp-agent.mjs");

async function start(autoRun: boolean) {
  const cwd = await mkdtemp(join(tmpdir(), "glassys-fake-acp-"));
  const storeDir = join(cwd, ".store");
  const options = { command: process.execPath, args: [FAKE_AGENT], autoRun };
  const session = await acpAdapter.create({ cwd, model: "fake-deep", modelParams: [], storeDir, options });
  return { cwd, storeDir, options, session };
}

async function turn(session: Awaited<ReturnType<typeof start>>["session"], text: string) {
  const events: ServerMessage[] = [];
  const run = await session.send(text, (e) => events.push(e));
  const status = await run.wait();
  return { events, status };
}

const ends = (events: ServerMessage[]) =>
  Object.fromEntries(events.flatMap((e) => (e.type === "tool.end" ? [[e.callId, e]] : [])));

describe("ACP adapter against scripts/fake-acp-agent.mjs", () => {
  it("paints the demo turn: thinking, diffs, a failed shell with its output, a read", async () => {
    const { cwd, session } = await start(true);
    try {
      const { events, status } = await turn(session, "demo");
      expect(status).toBe("finished");
      const text = events.flatMap((e) => (e.type === "text.delta" ? [e.text] : [])).join("");
      const thinking = events.flatMap((e) => (e.type === "thinking.delta" ? [e.text] : [])).join("");
      expect(thinking).toContain("fake-deep");
      expect(text).toContain("`demo.txt` was **written**");
      const end = ends(events);
      expect(end.w1).toMatchObject({ ok: true, stats: { add: 1, del: 0 } });
      expect(end.e1).toMatchObject({ ok: true, stats: { add: 1, del: 1 } });
      expect(end.x1).toMatchObject({ ok: false, kind: "shell", outputPreview: "checking\n", error: "exit 1" });
      expect(end.x1).not.toHaveProperty("denied", true);
      expect(end.r1).toMatchObject({ ok: true, outputPreview: "hello world\n" });
      await expect(readFile(join(cwd, "demo.txt"), "utf8")).resolves.toBe("hello world\n");
    } finally {
      await session.dispose();
    }
  }, 20_000);

  it("ends every write and the shell denied with auto-run off, and writes nothing", async () => {
    const { cwd, session } = await start(false);
    try {
      const { events } = await turn(session, "demo");
      const end = ends(events);
      for (const id of ["w1", "e1", "x1"]) expect(end[id]).toMatchObject({ ok: false, denied: true });
      await expect(readFile(join(cwd, "demo.txt"), "utf8")).rejects.toThrow();
    } finally {
      await session.dispose();
    }
  }, 20_000);

  it("cancels a long turn", async () => {
    const { session } = await start(true);
    try {
      const run = await session.send("long 30", () => undefined);
      await new Promise((r) => setTimeout(r, 300));
      await run.cancel();
      await expect(run.wait()).resolves.toBe("cancelled");
    } finally {
      await session.dispose();
    }
  }, 20_000);

  it("lists the models the agent announced, after a default that lets it choose", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "glassys-fake-acp-models-"));
    const ctx = { options: { command: process.execPath, args: [FAKE_AGENT] }, storeDir: join(cwd, ".store") };
    /* No session yet: one is opened just to read the catalog, which is then kept. */
    const first = await acpAdapter.listModels(undefined, cwd, ctx);
    expect(first.source).toBe("live");
    expect(first.models.map((m) => m.id)).toEqual(["default", "fake-fast", "fake-deep"]);
    const kept = JSON.parse(await readFile(join(ctx.storeDir, "models.json"), "utf8")) as { models: unknown[] };
    expect(kept.models).toHaveLength(2);
    await expect(acpAdapter.listModels(undefined, cwd)).resolves.toMatchObject({ source: "fallback" });
  }, 20_000);
});
