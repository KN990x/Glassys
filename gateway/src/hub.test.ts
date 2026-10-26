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

  it("says when a handshake buffer overflowed, so the socket can be given a fresh snapshot", async () => {
    const { MAX_HANDSHAKE_BUFFER } = await import("./hub.js");
    const hub = new Hub();
    const fake = fakeSocket([]);
    hub.add(fake, { buffer: true });
    hub.broadcast({ type: "text.delta", text: "a" });
    expect(hub.release(fake)).toBe(false);
    hub.add(fake, { buffer: true });
    for (let i = 0; i <= MAX_HANDSHAKE_BUFFER; i++) hub.broadcast({ type: "text.delta", text: String(i) });
    expect(hub.takeBuffer(fake)).toHaveLength(MAX_HANDSHAKE_BUFFER);
    expect(hub.release(fake)).toBe(true);
    expect(hub.release(fake)).toBe(false);
  });

  it("drops buffered events the snapshot already holds, by seq", () => {
    const buffered: ServerMessage[] = [
      { type: "text.delta", text: "in-snapshot", seq: 41 },
      { type: "text.delta", text: " ", seq: 42 },
      { type: "text.delta", text: " ", seq: 43 },
      { type: "session", profileId: PROFILE_ID, agentId: "a1", busy: false },
      { type: "run.start", runId: "r1" },
    ];
    const flushed = flushHandshakeBuffer(buffered, 42);
    expect(flushed).toEqual([
      { type: "text.delta", text: " ", seq: 43 },
      { type: "session", profileId: PROFILE_ID, agentId: "a1", busy: false },
      { type: "run.start", runId: "r1" },
    ]);
    expect(isHandshakeEphemeral(buffered[3]!)).toBe(true);
  });

  it("sends events without seq, as older writers produced them", () => {
    expect(flushHandshakeBuffer([{ type: "text.delta", text: "x" }], 10)).toHaveLength(1);
  });
});
