import type { WebSocket } from "ws";
import { verifySession } from "./auth.js";
import { log } from "./paths.js";

/** The session token each authenticated socket proved, so a logout or password change can end it. */
const sockets = new Map<WebSocket, string>();

export function trackSocketSession(ws: WebSocket, token: string): void {
  sockets.set(ws, token);
}

export function untrackSocket(ws: WebSocket): void {
  sockets.delete(ws);
}

export function trackedSocketCount(): number {
  return sockets.size;
}

/** Close every socket whose session no longer verifies (revoked, or signed under an old epoch/secret). */
export async function revalidateSockets(): Promise<void> {
  for (const [ws, token] of [...sockets]) {
    if (await verifySession(token)) continue;
    sockets.delete(ws);
    try {
      ws.send(JSON.stringify({ type: "auth.error", message: "unauthorized" }));
      ws.close(4001, "session ended");
    } catch (err) {
      log("warn", "closing ended session socket", { error: String(err) });
      ws.terminate();
    }
  }
}
