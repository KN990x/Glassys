import { WebSocket } from "ws";
import type { ServerMessage } from "@glassys/protocol";
import { isPersistedTranscriptEvent } from "@glassys/protocol";

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
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
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
        continue;
      }
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(raw);
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

/** After snapshot + later transcript read, send leftover buffer without duplicating persisted events. */
export function flushHandshakeBuffer(buffered: ServerMessage[], alreadySent: ServerMessage[]): ServerMessage[] {
  const seen = new Set(alreadySent.map((ev) => JSON.stringify(ev)));
  const out: ServerMessage[] = [];
  for (const msg of buffered) {
    if (isHandshakeEphemeral(msg)) {
      out.push(msg);
      continue;
    }
    const raw = JSON.stringify(msg);
    if (!seen.has(raw)) {
      out.push(msg);
      seen.add(raw);
    }
  }
  return out;
}

export const hub = new Hub();
