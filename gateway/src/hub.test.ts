import { describe, expect, it } from "vitest";
import { Hub, flushHandshakeBuffer, isHandshakeEphemeral } from "./hub.js";
import { WebSocket } from "ws";
import { PROFILE_ID, type ServerMessage } from "@glassys/protocol";

function fakeSocket(sent: string[]) {
  return {
    readyState: WebSocket.OPEN,
    send: (raw: string) => sent.push(raw),
  } as unknown as WebSocket;
}

describe("hub", () => {
  it("does not send to sockets that were never added", () => {
    const hub = new Hub();
    const sent: string[] = [];
    const fake = fakeSocket(sent);
    hub.broadcast({ type: "run.start", runId: "1" });
    expect(sent).toEqual([]);
    hub.add(fake);
    hub.broadcast({ type: "run.start", runId: "1" });
    expect(sent).toHaveLength(1);
    hub.remove(fake);
    hub.broadcast({ type: "run.start", runId: "2" });
    expect(sent).toHaveLength(1);
  });

  it("keeps broadcasting when one socket throws", () => {
    const hub = new Hub();
    const sent: string[] = [];
    const broken = {
      readyState: WebSocket.OPEN,
      send: () => {
        throw new Error("send failed");
      },
    } as unknown as WebSocket;
    const ok = fakeSocket(sent);
    hub.add(broken);
    hub.add(ok);
    hub.broadcast({ type: "run.start", runId: "1" });
    expect(sent).toHaveLength(1);
  });

  it("buffers broadcasts until release", () => {
    const hub = new Hub();
    const sent: string[] = [];
    const fake = fakeSocket(sent);
    hub.add(fake, { buffer: true });
    hub.broadcast({ type: "text.delta", text: "x" });
    expect(sent).toEqual([]);
    hub.send(fake, { type: "transcript.snapshot", events: [] });
    hub.release(fake);
    hub.broadcast({ type: "text.delta", text: "y" });
    expect(sent).toHaveLength(2);
    expect(JSON.parse(sent[0]).type).toBe("transcript.snapshot");
    expect(JSON.parse(sent[1]).text).toBe("y");
  });

  it("flushes leftover persisted deltas that missed the second transcript read", () => {
    const later = [{ type: "text.delta", text: "from-disk" } as const];
    const buffered: ServerMessage[] = [
      { type: "text.delta", text: "from-disk" },
      { type: "text.delta", text: "late-persist" },
      {
        type: "session",
        profileId: PROFILE_ID,
        agentId: "a1",
        busy: false,
      },
      { type: "run.start", runId: "r1" },
    ];
    const flushed = flushHandshakeBuffer(buffered, [...later]);
    expect(flushed.map((m) => m.type)).toEqual(["text.delta", "session", "run.start"]);
    expect(flushed.some((m) => m.type === "text.delta" && "text" in m && m.text === "late-persist")).toBe(true);
    expect(flushed.filter((m) => m.type === "text.delta" && "text" in m && m.text === "from-disk")).toHaveLength(0);
    expect(isHandshakeEphemeral(buffered[2]!)).toBe(true);
  });
});
