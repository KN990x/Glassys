import { PROTOCOL_VERSION, clampKeepaliveSeconds, type ClientMessage, type ServerMessage } from "@glassys/protocol";

export type ConnState = "connecting" | "connected" | "reconnecting" | "error";

export function openSocket(handlers: {
  onEvent: (msg: ServerMessage) => void;
  onState: (state: ConnState) => void;
}): { send: (msg: ClientMessage) => boolean; close: () => void; setKeepalive: (seconds: number) => void } {
  let closed = false;
  let fatal = false;
  let ws: WebSocket | null = null;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let keepaliveMs = 25_000;

  const clearPing = () => {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = undefined;
  };

  const startPing = (socket: WebSocket) => {
    clearPing();
    pingTimer = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "ping", ts: Date.now() } satisfies ClientMessage));
      }
    }, keepaliveMs);
  };

  const connect = () => {
    retryTimer = undefined;
    if (closed || fatal) return;
    handlers.onState(attempt === 0 ? "connecting" : "reconnecting");
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${proto}//${location.host}/ws`);
    ws = socket;

    socket.addEventListener("open", () => {
      startPing(socket);
      socket.send(JSON.stringify({ type: "hello", protocolVersion: PROTOCOL_VERSION } satisfies ClientMessage));
    });

    socket.addEventListener("message", (ev) => {
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
        clearPing();
        handlers.onState("error");
        handlers.onEvent(msg);
        socket.close();
        return;
      } else if (msg.type === "auth.error") {
        fatal = true;
        closed = true;
        clearPing();
        handlers.onState("error");
        socket.close();
      } else if (msg.type === "auth.ok") {
        attempt = 0;
        handlers.onState("connected");
      }
      handlers.onEvent(msg);
    });

    socket.addEventListener("error", () => {
      if (closed || fatal) return;
      handlers.onState(attempt === 0 ? "connecting" : "reconnecting");
    });

    socket.addEventListener("close", () => {
      clearPing();
      if (closed || fatal) return;
      attempt += 1;
      handlers.onState("reconnecting");
      const wait = Math.min(10_000, 500 * 2 ** attempt);
      retryTimer = setTimeout(connect, wait);
    });
  };

  connect();

  return {
    send: (msg) => {
      if (ws?.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify(msg));
      return true;
    },
    close: () => {
      closed = true;
      clearPing();
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = undefined;
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
