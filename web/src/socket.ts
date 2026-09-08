import { PROTOCOL_VERSION, clampKeepaliveSeconds, type ClientMessage, type ServerMessage } from "@glassys/protocol";
import { getToken } from "./api";

export type ConnState = "connecting" | "connected" | "reconnecting" | "error";

export function openSocket(handlers: {
  onEvent: (msg: ServerMessage) => void;
  onState: (state: ConnState) => void;
}): { send: (msg: ClientMessage) => boolean; close: () => void; setKeepalive: (seconds: number) => void } {
  let closed = false;
  let fatal = false;
  let ws: WebSocket | null = null;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
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
    if (closed || fatal) return;
    handlers.onState(attempt === 0 ? "connecting" : "reconnecting");
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${proto}//${location.host}/ws`);
    ws = socket;

    socket.addEventListener("open", () => {
      attempt = 0;
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
        socket.send(JSON.stringify({ type: "auth", token: getToken() ?? "" } satisfies ClientMessage));
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
      const wait = Math.min(10_000, 500 * 2 ** attempt);
      setTimeout(connect, wait);
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
