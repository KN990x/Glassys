import { WebSocket } from "ws";
import type { ServerMessage } from "@glassys/protocol";
import { isPersistedTranscriptEvent } from "@glassys/protocol";

export const MAX_HANDSHAKE_BUFFER = 500;
/** A client this far behind (stalled tab, dead link) is dropped; it reconnects and gets a snapshot. */
export const MAX_WS_BUFFERED_BYTES = 8 * 1024 * 1024;

function sendRaw(ws: WebSocket, raw: string): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  if (ws.bufferedAmount > MAX_WS_BUFFERED_BYTES) {
    ws.terminate();
    return;
  }
  ws.send(raw);
}

export class Hub {
  private clients = new Set<WebSocket>();
  /** While a socket is in this map, broadcasts are queued instead of sent. */
  private buffers = new Map<WebSocket, ServerMessage[]>();

  add(ws: WebSocket, opts?: { buffer?: boolean }): void {
    this.clients.add(ws);
    if (opts?.buffer) this.buffers.set(ws, []);
  }

  /** Drain queued broadcasts. The socket stays in buffer mode until `release`. */
  takeBuffer(ws: WebSocket): ServerMessage[] {
    const buf = this.buffers.get(ws);
    if (!buf?.length) return [];
    return buf.splice(0, buf.length);
  }

  /** Stop buffering. Remaining queued broadcasts are dropped. */
  release(ws: WebSocket): void {
    this.buffers.delete(ws);
  }

  remove(ws: WebSocket): void {
    this.clients.delete(ws);
    this.buffers.delete(ws);
  }

  send(ws: WebSocket, msg: ServerMessage): void {
    try {
      sendRaw(ws, JSON.stringify(msg));
    } catch {
      /* drop a broken socket; do not abort the rest of the hub */
    }
  }

  broadcast(msg: ServerMessage): void {
    const raw = JSON.stringify(msg);
    for (const ws of this.clients) {
      const buf = this.buffers.get(ws);
      if (buf) {
        buf.push(msg);
        if (buf.length > MAX_HANDSHAKE_BUFFER) buf.splice(0, buf.length - MAX_HANDSHAKE_BUFFER);
        continue;
      }
      try {
        sendRaw(ws, raw);
      } catch {
        /* continue to remaining clients */
      }
    }
  }

  get size(): number {
    return this.clients.size;
  }
}

/** Live control-plane events that are not in transcript.jsonl. */
export function isHandshakeEphemeral(msg: ServerMessage): boolean {
  return !isPersistedTranscriptEvent(msg);
}

/**
 * What a socket that was buffering during its handshake still needs after the snapshot: live-only
 * events, and persisted ones past `lastSeq` (the snapshot holds the rest). An event without seq
 * (an older writer) is sent, as before.
 */
export function flushHandshakeBuffer(buffered: ServerMessage[], lastSeq: number): ServerMessage[] {
  return buffered.filter((msg) => {
    if (isHandshakeEphemeral(msg)) return true;
    const seq = (msg as { seq?: unknown }).seq;
    return typeof seq !== "number" || seq > lastSeq;
  });
}

export const hub = new Hub();
