import { WebSocket, WebSocketServer } from "ws";
import type { IncomingMessage, Server } from "node:http";
import {
  PROTOCOL_VERSION,
  clampKeepaliveSeconds,
  DEFAULT_KEEPALIVE_SECONDS,
  isClientMessage,
  type ClientMessage,
  type ConfigPatch,
  type NoticeSubject,
} from "@glassys/protocol";
import { requestSessionToken, verifyEdge, verifySession } from "./auth.js";
import { revalidateSocket, revalidateSockets, trackSocketSession, trackedSocketCount, untrackSocket } from "./sessions.js";
import { originAllowed } from "./cors.js";
import { redacted, loadConfig } from "./config.js";
import { hub, flushHandshakeBuffer } from "./hub.js";
import { log } from "./paths.js";
import { HttpError } from "./errors.js";
import { runningBuild } from "./build-info.js";
import { createMutex } from "./lock.js";
import {
  applyConfigPatch,
  cancelQueued,
  cancelRun,
  cwdErrorInPatch,
  drainEmit,
  enqueueMessage,
  listLiveThreads,
  readTranscriptSnapshot,
  snapshotQueue,
  snapshotRuntime,
  startNewLiveThread,
  switchLiveThread,
} from "./runtime.js";

const MAX_WS_PAYLOAD = 1_000_000;
/** A failed client request becomes a notice about what it asked for, never a `run.error`. */
function noticeSubject(type: ClientMessage["type"]): NoticeSubject {
  if (type === "user.message") return "message";
  if (type === "run.cancel" || type === "queue.cancel") return "cancel";
  if (type === "thread.new" || type === "thread.switch") return "thread";
  return "request";
}

export const WS_HANDSHAKE_TIMEOUT_MS = 15_000;
/** One operator: a few tabs and devices. Far more than this is a leak or a flood. */
export const MAX_WS_CONNECTIONS = 32;
/**
 * Sockets that have not authenticated yet and brought no session cookie. Kept small and apart
 * from the operator's own sockets, so anonymous connections cannot take every slot.
 */
export const MAX_WS_ANONYMOUS = 8;
/** Client messages are handled one at a time per socket; a backlog this deep means a flood. */
export const MAX_WS_PENDING_MESSAGES = 64;

interface SocketState {
  hello: boolean;
  auth: boolean;
  pingTimer?: ReturnType<typeof setInterval>;
  handshakeTimer?: ReturnType<typeof setTimeout>;
  alive: boolean;
  /** The close handler already ran: anything registered for this socket after it would leak. */
  closed: boolean;
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
          const authed = trackedSocketCount();
          if (authed >= MAX_WS_CONNECTIONS) {
            cb(false, 503, "too many connections");
            return;
          }
          /* The PWA's upgrade carries its session cookie; one without it has to wait its turn. */
          if (wss.clients.size - authed >= MAX_WS_ANONYMOUS && (await requestSessionToken(info.req)) === null) {
            cb(false, 503, "too many connections");
            return;
          }
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

  wss.on("error", (err: NodeJS.ErrnoException) => {
    /* ws re-emits the HTTP server's listen errors; index.ts logs (and retries) those. */
    if (err.syscall === "listen") return;
    log("error", "wss", { error: String(err) });
  });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const state: SocketState = { hello: false, auth: false, alive: true, closed: false };
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
      /* The config read can finish after a quick close; an interval set then would never stop. */
      if (state.closed) return;
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
        if (state.auth) void revalidateSocket(ws).catch(() => undefined);
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
      state.closed = true;
      if (state.handshakeTimer) clearTimeout(state.handshakeTimer);
      if (state.pingTimer) clearInterval(state.pingTimer);
      hub.remove(ws);
      untrackSocket(ws);
    });

    let pendingMessages = 0;
    ws.on("message", (raw) => {
      state.alive = true;
      if (pendingMessages >= MAX_WS_PENDING_MESSAGES) {
        log("warn", "ws client flooded the message queue; closing");
        ws.close(1008, "too many pending messages");
        return;
      }
      pendingMessages += 1;
      void enqueue(async () => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(raw));
        } catch {
          log("warn", "invalid ws json");
          if (state.auth) hub.send(ws, { type: "notice", level: "error", message: "invalid json", about: "request" });
          return;
        }
        if (!isClientMessage(parsed)) {
          if (state.auth) hub.send(ws, { type: "notice", level: "error", message: "unknown message", about: "request" });
          return;
        }
        try {
          await handleClient(ws, state, parsed, req);
        } catch (err) {
          log("error", "ws handler", { error: String(err) });
          if (!state.auth) return;
          const message = err instanceof HttpError ? err.message : "internal error";
          if (parsed.type === "config.set" || parsed.type === "config.get") {
            hub.send(ws, { type: "config.error", message });
          } else {
            hub.send(ws, { type: "notice", level: "error", message, about: noticeSubject(parsed.type) });
          }
        }
      })
        .catch((err) => log("error", "ws queue", { error: String(err) }))
        .finally(() => {
          pendingMessages -= 1;
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
    const { commit } = runningBuild();
    hub.send(ws, { type: "hello.ok", protocolVersion: PROTOCOL_VERSION, ...(commit ? { commit } : {}) });
    return;
  }

  if (!state.hello) {
    log("warn", "ws message before hello", { type: msg.type });
    return;
  }

  if (msg.type === "auth") {
    const token = (await verifySession(msg.token)) ? msg.token : await requestSessionToken(req);
    if (state.closed) return;
    if (!token) {
      hub.send(ws, { type: "auth.error", message: "unauthorized" });
      return;
    }
    state.auth = true;
    trackSocketSession(ws, token);
    try {
      if (state.handshakeTimer) clearTimeout(state.handshakeTimer);
      const config = await redacted();
      /* Buffer broadcasts from here on; the snapshot then says how far it got (lastSeq), and
         buffered events it already holds are dropped by seq instead of sent twice. */
      hub.add(ws, { buffer: true });
      await drainEmit();
      const snap = await readTranscriptSnapshot();
      hub.send(ws, { type: "auth.ok" });
      hub.send(ws, { type: "config", config });
      hub.send(ws, {
        type: "transcript.snapshot",
        events: snap.events,
        ...(snap.truncated ? { truncated: true } : {}),
        lastSeq: snap.lastSeq,
      });
      for (const buffered of flushHandshakeBuffer(hub.takeBuffer(ws), snap.lastSeq)) {
        hub.send(ws, buffered);
      }
      hub.send(ws, { type: "session", ...snapshotRuntime() });
      hub.send(ws, { type: "queue.snapshot", items: snapshotQueue() });
      hub.send(ws, {
        type: "threads.snapshot",
        threads: await listLiveThreads(),
        currentId: snapshotRuntime().threadId ?? null,
      });
      for (const leftover of flushHandshakeBuffer(hub.takeBuffer(ws), snap.lastSeq)) {
        hub.send(ws, leftover);
      }
      if (hub.release(ws)) {
        /* Events were dropped while this socket caught up: start it over from what is on disk,
           buffering again meanwhile so nothing falls between the new snapshot and live events. */
        hub.add(ws, { buffer: true });
        await drainEmit();
        const fresh = await readTranscriptSnapshot();
        hub.send(ws, {
          type: "transcript.snapshot",
          events: fresh.events,
          ...(fresh.truncated ? { truncated: true } : {}),
          lastSeq: fresh.lastSeq,
        });
        for (const leftover of flushHandshakeBuffer(hub.takeBuffer(ws), fresh.lastSeq)) hub.send(ws, leftover);
        hub.release(ws);
      }
    } catch (err) {
      /* Left buffering without a snapshot, the socket would never see a live event again. */
      log("error", "ws handshake", { error: String(err) });
      hub.remove(ws);
      ws.close(1011, "handshake failed");
    } finally {
      /* Closed mid-handshake: its close handler ran before the entries above were added. */
      if (state.closed) {
        hub.remove(ws);
        untrackSocket(ws);
      }
    }
    return;
  }

  if (!state.auth) {
    hub.send(ws, { type: "auth.error", message: "unauthorized" });
    return;
  }

  switch (msg.type) {
    case "user.message":
      await enqueueMessage(msg.text, msg.attachments, msg.id, "user", (message) =>
        hub.send(ws, { type: "notice", level: "error", message, about: "message" }),
      );
      break;
    case "run.cancel":
      await cancelRun((message) => hub.send(ws, { type: "notice", level: "warn", message, about: "cancel" }));
      break;
    case "queue.cancel":
      await cancelQueued(msg.id);
      break;
    case "thread.new":
      try {
        await startNewLiveThread();
      } catch (err) {
        hub.send(ws, { type: "notice", level: "error", message: err instanceof Error ? err.message : String(err), about: "thread" });
      }
      break;
    case "thread.switch":
      try {
        await switchLiveThread(msg.id);
      } catch (err) {
        hub.send(ws, { type: "notice", level: "error", message: err instanceof Error ? err.message : String(err), about: "thread" });
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
      if (patch.operatorPassword) await revalidateSockets();
      break;
    }
    default:
      log("warn", "unknown ws message");
  }
}
