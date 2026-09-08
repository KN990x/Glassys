import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { WebSocket } from "ws";
import { defaultConfig, PROTOCOL_VERSION } from "@glassys/protocol";
import { handleHttp } from "./http.js";
import { attachWs, closeWs } from "./ws.js";
import { hashPassword, loadSecrets, patchSecrets } from "./secrets.js";
import { shutdownRuntime } from "./runtime.js";
import { appendTranscript } from "./transcript.js";
import { hub } from "./hub.js";

async function listen(server: Server): Promise<{ url: string; port: number }> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no port");
      resolve({ url: `http://127.0.0.1:${addr.port}`, port: addr.port });
    });
  });
}

async function waitUntil(fn: () => boolean | Promise<boolean>, ms = 2000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("timeout");
}

function waitMessage(ws: WebSocket, type: string, ms = 3000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), ms);
    const onMsg = (raw: WebSocket.RawData) => {
      const msg = JSON.parse(String(raw)) as Record<string, unknown>;
      if (msg.type !== type) return;
      cleanup();
      resolve(msg);
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      clearTimeout(timer);
      ws.off("message", onMsg);
      ws.off("error", onError);
    };
    ws.on("message", onMsg);
    ws.on("error", onError);
  });
}

async function openClient(url: string, origin: string): Promise<WebSocket> {
  const ws = new WebSocket(`${url.replace("http", "ws")}/ws`, { origin });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return ws;
}

describe("websocket handshake", () => {
  let dir: string;
  let server: Server;
  let url: string;
  let origin: string;
  let token: string;
  let wss: ReturnType<typeof attachWs>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "glassys-ws-"));
    process.env.GLASSYS_DATA_DIR = dir;
    delete process.env.GLASSYS_JWT_SECRET;
    const cfg = defaultConfig();
    cfg.onboarding.completed = true;
    cfg.agent.cwd = dir;
    await writeFile(join(dir, "config.yaml"), YAML.stringify(cfg), "utf8");
    await loadSecrets();
    await patchSecrets({ operatorPasswordHash: await hashPassword("password1") });
    server = createServer(async (req, res) => {
      const handled = await handleHttp(req, res);
      if (!handled && !res.writableEnded) {
        res.writeHead(404);
        res.end();
      }
    });
    wss = attachWs(server, 25);
    const addr = await listen(server);
    url = addr.url;
    origin = url;
    const login = await fetch(`${url}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "password1" }),
    });
    expect(login.status).toBe(200);
    token = ((await login.json()) as { token: string }).token;
  });

  afterEach(async () => {
    await shutdownRuntime();
    await closeWs(wss);
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  it("rejects an incompatible protocol version", async () => {
    const ws = await openClient(url, origin);
    const wait = waitMessage(ws, "hello.incompatible");
    ws.send(JSON.stringify({ type: "hello", protocolVersion: PROTOCOL_VERSION + 1 }));
    const msg = await wait;
    expect(msg.protocolVersion).toBe(PROTOCOL_VERSION);
    ws.close();
  });

  it("auths and sends a transcript snapshot before live events", async () => {
    await appendTranscript({ type: "user.message", text: "hi" });
    await appendTranscript({ type: "text.delta", text: "there" });

    const ws = await openClient(url, origin);
    const types: string[] = [];
    ws.on("message", (raw) => {
      types.push((JSON.parse(String(raw)) as { type: string }).type);
    });
    const helloOk = waitMessage(ws, "hello.ok");
    ws.send(JSON.stringify({ type: "hello", protocolVersion: PROTOCOL_VERSION }));
    await helloOk;
    const snap = waitMessage(ws, "transcript.snapshot");
    ws.send(JSON.stringify({ type: "auth", token }));
    const snapshot = await snap;
    const events = snapshot.events as Array<{ type: string; text?: string }>;
    expect(events.some((e) => e.type === "user.message" && e.text === "hi")).toBe(true);
    expect(events.some((e) => e.type === "text.delta" && e.text === "there")).toBe(true);

    const snapAt = types.indexOf("transcript.snapshot");
    expect(snapAt).toBeGreaterThanOrEqual(0);
    expect(types.indexOf("auth.ok")).toBeLessThan(snapAt);
    expect(types.indexOf("hello.ok")).toBeLessThan(types.indexOf("auth.ok"));

    await waitUntil(() => types.lastIndexOf("session") > snapAt);
    const live = waitMessage(ws, "text.delta");
    hub.broadcast({ type: "text.delta", text: "after-snapshot" });
    const liveMsg = await live;
    expect(liveMsg.text).toBe("after-snapshot");
    expect(types.filter((t) => t === "transcript.snapshot")).toHaveLength(1);
    ws.close();
  });

  it("sends a current session after the snapshot so reconnect does not stick busy", async () => {
    const { snapshotRuntime } = await import("./runtime.js");
    const ws = await openClient(url, origin);
    const messages: Array<Record<string, unknown>> = [];
    ws.on("message", (raw) => {
      messages.push(JSON.parse(String(raw)) as Record<string, unknown>);
    });
    ws.send(JSON.stringify({ type: "hello", protocolVersion: PROTOCOL_VERSION }));
    await waitMessage(ws, "hello.ok");
    hub.broadcast({ type: "session", profileId: "default", agentId: "x", busy: true });
    ws.send(JSON.stringify({ type: "auth", token }));
    await waitMessage(ws, "transcript.snapshot");
    await new Promise((r) => setTimeout(r, 50));
    const sessions = messages.filter((m) => m.type === "session");
    expect(sessions.length).toBeGreaterThanOrEqual(1);
    expect(sessions.at(-1)?.busy).toBe(snapshotRuntime().busy);
    const snapAt = messages.findIndex((m) => m.type === "transcript.snapshot");
    const lastSessionAt = messages.map((m) => m.type).lastIndexOf("session");
    expect(lastSessionAt).toBeGreaterThan(snapAt);
    ws.close();
  });

  it("closes sockets that never finish hello/auth", async () => {
    await closeWs(wss);
    wss = attachWs(server, 25, 80);
    const ws = await openClient(url, origin);
    const code = await new Promise<number>((resolve) => {
      ws.on("close", (c) => resolve(c));
    });
    expect(code).toBe(4008);
  });
});
