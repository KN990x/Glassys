import { WebSocket, WebSocketServer } from "ws";
import type { IncomingMessage, Server } from "node:http";
import {
  PROTOCOL_VERSION,
  clampKeepaliveSeconds,
  DEFAULT_KEEPALIVE_SECONDS,
  isClientMessage,
  type ClientMessage,
  type ConfigPatch,
} from "@glassys/protocol";
import { verifyEdge, verifyRequestSession, verifySession } from "./auth.js";
import { originAllowed } from "./cors.js";
import { redacted, loadConfig } from "./config.js";
import { hub, flushHandshakeBuffer } from "./hub.js";
import { log } from "./paths.js";
import { HttpError } from "./errors.js";
import { createMutex } from "./lock.js";
import {
  applyConfigPatch,
  cancelQueued,
  cancelRun,
  cwdErrorInPatch,
  drainEmit,
  enqueueMessage,
  listLiveThreads,
  readTranscript,
  snapshotQueue,
  snapshotRuntime,
  startNewLiveThread,
  switchLiveThread,
} from "./runtime.js";

const MAX_WS_PAYLOAD = 1_000_000;
export const WS_HANDSHAKE_TIMEOUT_MS = 15_000;

interface SocketState {
  hello: boolean;
  auth: boolean;
  pingTimer?: ReturnType<typeof setInterval>;
  handshakeTimer?: ReturnType<typeof setTimeout>;
  alive: boolean;
}

export function attachWs(
  server: Server,
  keepaliveSeconds?: number,
  handshakeTimeoutMs = WS_HANDSHAKE_TIMEOUT_MS,
): WebSocketServer {
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    maxPayload: MAX_WS_PAYLOAD,
    verifyClient: (info, cb) => {
      void (async () => {
        try {
          if (!(await originAllowed(info.origin, info.req.headers.host))) {
            cb(false, 403, "origin not allowed");
            return;
          }
          const edge = await verifyEdge(info.req);
          if (!edge.ok) {
            cb(false, 403, edge.reason || "edge auth failed");
            return;
          }
          cb(true);
        } catch (err) {
          log("error", "ws verifyClient", { error: String(err) });
          cb(false, 500, "internal error");
        }
      })();
    },
  });

  wss.on("error", (err) => {
    log("error", "wss", { error: String(err) });
  });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const state: SocketState = { hello: false, auth: false, alive: true };
    const enqueue = createMutex();
    state.handshakeTimer = setTimeout(() => {
      if (state.auth) return;
      try {
        ws.close(4008, "handshake timeout");
      } catch {
        ws.terminate();
      }
    }, handshakeTimeoutMs);

    const startBeat = (seconds: number) => {
      if (state.pingTimer) clearInterval(state.pingTimer);
      const beat = clampKeepaliveSeconds(seconds) * 1000;
      state.pingTimer = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (!state.alive) {
          ws.terminate();
          return;
        }
        state.alive = false;
        ws.ping();
      }, beat);
    };

    if (keepaliveSeconds !== undefined) {
      startBeat(keepaliveSeconds);
    } else {
      void loadConfig()
        .then((cfg) => startBeat(cfg.network.wsKeepaliveSeconds))
        .catch(() => startBeat(DEFAULT_KEEPALIVE_SECONDS));
    }

    ws.on("pong", () => {
      state.alive = true;
    });

    ws.on("error", (err) => {
      log("warn", "ws", { error: String(err) });
    });

    ws.on("close", () => {
      if (state.handshakeTimer) clearTimeout(state.handshakeTimer);
      if (state.pingTimer) clearInterval(state.pingTimer);
      hub.remove(ws);
    });

    ws.on("message", (raw) => {
      state.alive = true;
      void enqueue(async () => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(raw));
        } catch {
          log("warn", "invalid ws json");
          return;
        }
        if (!isClientMessage(parsed)) return;
        try {
          await handleClient(ws, state, parsed, req);
        } catch (err) {
          log("error", "ws handler", { error: String(err) });
          if (!state.auth) return;
          const message = err instanceof HttpError ? err.message : "internal error";
          if (parsed.type === "run.cancel") {
            hub.send(ws, { type: "run.error", message, phase: "run" });
          } else if (parsed.type === "user.message") {
            hub.send(ws, { type: "run.error", message, phase: "startup" });
          } else {
            hub.send(ws, { type: "config.error", message });
          }
        }
      });
    });
  });

  return wss;
}

export async function closeWs(wss: WebSocketServer): Promise<void> {
  for (const client of wss.clients) {
    try {
      client.terminate();
    } catch {
      /* ignore */
    }
  }
  await new Promise<void>((resolve) => {
    wss.close(() => resolve());
    setTimeout(resolve, 2000);
  });
}

async function handleClient(
  ws: WebSocket,
  state: SocketState,
  msg: ClientMessage,
  req: IncomingMessage,
): Promise<void> {
  if (msg.type === "ping") {
    hub.send(ws, { type: "pong", ts: msg.ts });
    return;
  }

  if (msg.type === "hello") {
    if (msg.protocolVersion !== PROTOCOL_VERSION) {
      hub.send(ws, { type: "hello.incompatible", protocolVersion: PROTOCOL_VERSION });
      ws.close(1002, "incompatible protocol");
      return;
    }
    state.hello = true;
    hub.send(ws, { type: "hello.ok", protocolVersion: PROTOCOL_VERSION });
    return;
  }

  if (!state.hello) {
    log("warn", "ws message before hello", { type: msg.type });
    return;
  }

  if (msg.type === "auth") {
    const ok = (await verifySession(msg.token)) || (await verifyRequestSession(req));
    if (!ok) {
      hub.send(ws, { type: "auth.error", message: "unauthorized" });
      return;
    }
    state.auth = true;
    if (state.handshakeTimer) clearTimeout(state.handshakeTimer);
    const config = await redacted();
    hub.add(ws, { buffer: true });
    await drainEmit();
    const events = await readTranscript();
    hub.send(ws, { type: "auth.ok" });
    hub.send(ws, { type: "config", config });
    hub.send(ws, { type: "transcript.snapshot", events });
    await drainEmit();
    const later = await readTranscript();
    const extra = later.slice(events.length);
    for (const ev of extra) {
      hub.send(ws, ev);
    }
    for (const buffered of flushHandshakeBuffer(hub.takeBuffer(ws), extra)) {
      hub.send(ws, buffered);
    }
    hub.send(ws, { type: "session", ...snapshotRuntime() });
    hub.send(ws, { type: "queue.snapshot", items: snapshotQueue() });
    hub.send(ws, {
      type: "threads.snapshot",
      threads: await listLiveThreads(),
      currentId: snapshotRuntime().threadId ?? null,
    });
    for (const leftover of flushHandshakeBuffer(hub.takeBuffer(ws), [])) {
      hub.send(ws, leftover);
    }
    hub.release(ws);
    return;
  }

  if (!state.auth) {
    hub.send(ws, { type: "auth.error", message: "unauthorized" });
    return;
  }

  switch (msg.type) {
    case "user.message":
      await enqueueMessage(msg.text, msg.attachments, msg.id);
      break;
    case "run.cancel":
      await cancelRun();
      break;
    case "queue.cancel":
      await cancelQueued(msg.id);
      break;
    case "thread.new":
      try {
        await startNewLiveThread();
      } catch (err) {
        hub.send(ws, {
          type: "config.error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    case "thread.switch":
      try {
        await switchLiveThread(msg.id);
      } catch (err) {
        hub.send(ws, {
          type: "config.error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    case "config.get":
      hub.send(ws, { type: "config", config: await redacted() });
      break;
    case "config.set": {
      const patch = msg.patch as ConfigPatch;
      const cwdError = await cwdErrorInPatch(patch);
      if (cwdError) {
        hub.send(ws, { type: "config.error", message: cwdError });
        break;
      }
      await applyConfigPatch(patch);
      break;
    }
    default:
      log("warn", "unknown ws message");
  }
}
