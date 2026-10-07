import { PROTOCOL_VERSION, clampKeepaliveSeconds, type ClientMessage, type ServerMessage } from "@glassys/protocol";

export type ConnState = "connecting" | "connected" | "reconnecting" | "error";

/** A connection that stays up this long counts as healthy, and the backoff starts over. */
const HEALTHY_AFTER_MS = 10_000;
/** After a wake-up or a network change, how long a ping may go unanswered before reconnecting. */
const WAKE_PROBE_MS = 5_000;

export function openSocket(handlers: {
  onEvent: (msg: ServerMessage) => void;
  onState: (state: ConnState) => void;
}): { send: (msg: ClientMessage) => boolean; close: () => void; setKeepalive: (seconds: number) => void } {
  let closed = false;
  let fatal = false;
  let ws: WebSocket | null = null;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let healthyTimer: ReturnType<typeof setTimeout> | undefined;
  let probeTimer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let keepaliveMs = 25_000;
  /** When this socket last heard anything; a half-open connection (sleeping phone, NAT drop) goes quiet. */
  let lastHeard = Date.now();

  const clearTimers = () => {
    if (pingTimer) clearInterval(pingTimer);
    if (healthyTimer) clearTimeout(healthyTimer);
    if (probeTimer) clearTimeout(probeTimer);
    pingTimer = healthyTimer = probeTimer = undefined;
  };

  const ping = (socket: WebSocket) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "ping", ts: Date.now() } satisfies ClientMessage));
    }
  };

  const startPing = (socket: WebSocket) => {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      /* Two keepalives without a word back: the link is dead even if the browser has not noticed. */
      if (Date.now() - lastHeard > keepaliveMs * 2 + WAKE_PROBE_MS) {
        socket.close();
        return;
      }
      ping(socket);
    }, keepaliveMs);
  };

  const scheduleRetry = () => {
    attempt += 1;
    handlers.onState("reconnecting");
    const base = Math.min(10_000, 500 * 2 ** attempt);
    /* Jitter, so every tab and device of an operator does not reconnect in the same instant. */
    retryTimer = setTimeout(connect, base + Math.floor(Math.random() * base * 0.25));
  };

  const connect = () => {
    retryTimer = undefined;
    if (closed || fatal) return;
    handlers.onState(attempt === 0 ? "connecting" : "reconnecting");
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${proto}//${location.host}/ws`);
    ws = socket;
    lastHeard = Date.now();

    socket.addEventListener("open", () => {
      lastHeard = Date.now();
      startPing(socket);
      socket.send(JSON.stringify({ type: "hello", protocolVersion: PROTOCOL_VERSION } satisfies ClientMessage));
    });

    socket.addEventListener("message", (ev) => {
      lastHeard = Date.now();
      if (probeTimer) {
        clearTimeout(probeTimer);
        probeTimer = undefined;
      }
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === "hello.ok") {
        /* The upgrade request carried the session cookie; the gateway authenticates with that. */
        socket.send(JSON.stringify({ type: "auth", token: "" } satisfies ClientMessage));
      } else if (msg.type === "hello.incompatible") {
        fatal = true;
        closed = true;
        clearTimers();
        handlers.onState("error");
        handlers.onEvent(msg);
        socket.close();
        return;
      } else if (msg.type === "auth.error") {
        fatal = true;
        closed = true;
        clearTimers();
        handlers.onState("error");
        socket.close();
      } else if (msg.type === "auth.ok") {
        handlers.onState("connected");
        /* A gateway that drops us right after auth would otherwise be retried every second. */
        if (healthyTimer) clearTimeout(healthyTimer);
        healthyTimer = setTimeout(() => {
          if (ws === socket && socket.readyState === WebSocket.OPEN) attempt = 0;
        }, HEALTHY_AFTER_MS);
      }
      handlers.onEvent(msg);
    });

    socket.addEventListener("error", () => {
      if (closed || fatal) return;
      handlers.onState(attempt === 0 ? "connecting" : "reconnecting");
    });

    socket.addEventListener("close", () => {
      if (ws !== socket) return;
      clearTimers();
      if (closed || fatal) return;
      scheduleRetry();
    });
  };

  /*
   * Back from the background or onto a network: a socket that looks open may be long dead.
   * Retry now instead of waiting out the backoff, or prove an open one alive with a ping.
   */
  const wake = () => {
    if (closed || fatal) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      if (retryTimer) clearTimeout(retryTimer);
      connect();
      return;
    }
    if (ws.readyState !== WebSocket.OPEN || probeTimer) return;
    const socket = ws;
    ping(socket);
    probeTimer = setTimeout(() => {
      probeTimer = undefined;
      socket.close();
    }, WAKE_PROBE_MS);
  };
  if (typeof window !== "undefined") window.addEventListener("online", wake);
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", wake);

  connect();

  return {
    send: (msg) => {
      if (ws?.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify(msg));
      return true;
    },
    close: () => {
      closed = true;
      clearTimers();
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = undefined;
      if (typeof window !== "undefined") window.removeEventListener("online", wake);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", wake);
      ws?.close();
    },
    setKeepalive: (seconds) => {
      const next = clampKeepaliveSeconds(seconds) * 1000;
      if (next === keepaliveMs) return;
      keepaliveMs = next;
      if (ws && ws.readyState === WebSocket.OPEN) startPing(ws);
    },
  };
}
