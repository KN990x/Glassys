import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { defaultConfig, PROTOCOL_VERSION } from "@glassys/protocol";
import { handleHttp } from "./http.js";
import { hashPassword, loadSecrets, patchSecrets } from "./secrets.js";
import { resetLiveThreadCache } from "./threads.js";
import { setRestartHandler } from "./restart.js";
import { setRuntimeBusyForTests } from "./runtime.js";

async function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no port");
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

describe("http api", () => {
  let dir: string;
  let server: Server;
  let base: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "glassys-http-"));
    process.env.GLASSYS_DATA_DIR = dir;
    resetLiveThreadCache();
    delete process.env.GLASSYS_JWT_SECRET;
    const cfg = defaultConfig();
    cfg.agent.cwd = "";
    await writeFile(join(dir, "config.yaml"), YAML.stringify(cfg), "utf8");
    await loadSecrets();
    server = createServer(async (req, res) => {
      const handled = await handleHttp(req, res);
      if (!handled && !res.writableEnded) {
        res.writeHead(404);
        res.end();
      }
    });
    base = await listen(server);
  });

  afterEach(async () => {
    resetLiveThreadCache();
    setRuntimeBusyForTests(false);
    setRestartHandler(async () => undefined);
    const { setDetectServiceForTests } = await import("./admin-update.js");
    setDetectServiceForTests(null);
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  it("reports the gateway package version on /health", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; name: string; version: string; protocolVersion: number };
    expect(body.ok).toBe(true);
    expect(body.name).toBe("glassys");
    expect(body.version).toBe("0.1.0");
    expect(body.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it("rejects a short setup password", async () => {
    const res = await fetch(`${base}/api/auth/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "short" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a setup password that is too long", async () => {
    const res = await fetch(`${base}/api/auth/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "x".repeat(257) }),
    });
    expect(res.status).toBe(400);
  });

  it("sets up, logs in, and refuses onboarding without a cwd", async () => {
    const setup = await fetch(`${base}/api/auth/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "password1" }),
    });
    expect(setup.status).toBe(200);
    const { token } = (await setup.json()) as { token: string };
    const login = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "password1" }),
    });
    expect(login.status).toBe(200);

    const onboard = await fetch(`${base}/api/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ onboarding: { completed: true } }),
    });
    expect(onboard.status).toBe(400);

    const ok = await fetch(`${base}/api/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ onboarding: { completed: true }, agent: { cwd: dir } }),
    });
    expect(ok.status).toBe(200);
  });

  it("does not swap in Cursor's catalog for another adapter", async () => {
    await patchSecrets({ operatorPasswordHash: await hashPassword("password1") });
    const login = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "password1" }),
    });
    const { token } = (await login.json()) as { token: string };
    const claude = await fetch(`${base}/api/models?adapter=claude`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(claude.status).toBe(200);
    const body = (await claude.json()) as { models: Array<{ id: string }>; source: string };
    expect(body.models.some((m) => m.id === "grok-4.6")).toBe(false);
    expect(body.models.length).toBeGreaterThan(0);
  });

  it("lists threads, reachability, and image uploads for an operator", async () => {
    await patchSecrets({ operatorPasswordHash: await hashPassword("password1") });
    const login = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "password1" }),
    });
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };
    const threads = await fetch(`${base}/api/threads`, { headers: auth });
    expect(threads.status).toBe(200);
    const listed = (await threads.json()) as { threads: unknown[]; currentId: string | null };
    expect(listed.currentId).toBeTruthy();
    const del = await fetch(`${base}/api/threads/${listed.currentId}`, { method: "DELETE", headers: auth });
    expect(del.status).toBe(200);
    const after = (await del.json()) as { currentId: string | null };
    expect(after.currentId).toBeTruthy();
    expect(after.currentId).not.toBe(listed.currentId);
    const reach = await fetch(`${base}/api/reachability`, { headers: auth });
    expect(reach.status).toBe(200);
    const reachBody = (await reach.json()) as { bind: string; loopback: boolean; port: number; hostname: string; user: string };
    expect(reachBody.bind).toBe("127.0.0.1");
    expect(reachBody.loopback).toBe(true);
    expect(reachBody.hostname).toBeTruthy();
    expect(reachBody.user).toBeTruthy();
    const ws = await fetch(`${base}/api/workspaces`, { headers: auth });
    expect(ws.status).toBe(200);
    expect(((await ws.json()) as { pins: string[] }).pins).toEqual([]);
    const pin = await fetch(`${base}/api/workspaces/pins`, {
      method: "PUT",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ pins: [dir] }),
    });
    expect(pin.status).toBe(200);
    const wsPinned = await fetch(`${base}/api/workspaces`, { headers: auth });
    expect(((await wsPinned.json()) as { pins: string[] }).pins).toEqual([dir]);
    const { setDetectServiceForTests } = await import("./admin-update.js");
    setDetectServiceForTests("none");
    const upgrade = await fetch(`${base}/api/admin/upgrade`, { method: "POST", headers: auth });
    expect(upgrade.status).toBe(409);
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const up = await fetch(`${base}/api/uploads?name=a.png`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "image/png" },
      body: png,
    });
    expect(up.status).toBe(200);
    const att = (await up.json()) as { id: string; mime: string };
    expect(att.mime).toBe("image/png");
    const get = await fetch(`${base}/api/uploads/${att.id}`, { headers: auth });
    expect(get.status).toBe(200);
    expect(get.headers.get("content-type")).toContain("image/png");
  });

  it("renames, exports, and refuses thread mutations while busy", async () => {
    await patchSecrets({ operatorPasswordHash: await hashPassword("password1") });
    const login = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "password1" }),
    });
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };
    const listed = (await (await fetch(`${base}/api/threads`, { headers: auth })).json()) as {
      threads: Array<{ id: string; title: string }>;
      currentId: string;
    };
    const id = listed.currentId;
    const renamed = await fetch(`${base}/api/threads/${id}`, {
      method: "PATCH",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Ops box" }),
    });
    expect(renamed.status).toBe(200);
    const after = (await renamed.json()) as { threads: Array<{ id: string; title: string }> };
    expect(after.threads.find((t) => t.id === id)?.title).toBe("Ops box");
    const empty = await fetch(`${base}/api/threads/${id}`, {
      method: "PATCH",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "  " }),
    });
    expect(empty.status).toBe(400);
    const exported = await fetch(`${base}/api/threads/${id}/export`, { headers: auth });
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-type")).toContain("text/markdown");
    expect(await exported.text()).toContain("Ops box");
    setRuntimeBusyForTests(true);
    const created = await fetch(`${base}/api/threads`, { method: "POST", headers: auth });
    expect(created.status).toBe(409);
    const switched = await fetch(`${base}/api/threads/${id}/switch`, { method: "POST", headers: auth });
    expect(switched.status).toBe(409);
    setRuntimeBusyForTests(false);
  });

  it("does not clear the session cookie on logout without a session", async () => {
    const res = await fetch(`${base}/api/auth/logout`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("accepts POST /api/admin/restart without exiting the process", async () => {
    const restart = vi.fn(async () => undefined);
    setRestartHandler(restart);
    await patchSecrets({ operatorPasswordHash: await hashPassword("password1") });
    const login = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "password1" }),
    });
    const { token } = (await login.json()) as { token: string };
    const res = await fetch(`${base}/api/admin/restart`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 80));
    expect(restart).toHaveBeenCalled();
  });
});
