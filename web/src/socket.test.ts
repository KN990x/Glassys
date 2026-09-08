import { afterEach, describe, expect, it, vi } from "vitest";

describe("socket keepalive clamp", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("clamps application ping interval to 15–30 seconds", async () => {
    const delays: number[] = [];
    vi.stubGlobal("setInterval", ((_fn: () => void, ms: number) => {
      delays.push(ms);
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval);
    vi.stubGlobal("clearInterval", () => undefined);
    class FakeSocket {
      readyState = 1;
      addEventListener(type: string, fn: () => void) {
        if (type === "open") queueMicrotask(fn);
      }
      send() {
        /* ignore */
      }
      close() {
        this.readyState = 3;
      }
    }
    const WS = Object.assign(
      vi.fn(() => new FakeSocket()),
      { OPEN: 1, CONNECTING: 0, CLOSING: 2, CLOSED: 3 },
    );
    vi.stubGlobal("WebSocket", WS);
    vi.stubGlobal("location", { protocol: "http:", host: "127.0.0.1:8787" });
    const { openSocket } = await import("./socket");
    const sock = openSocket({
      onEvent: () => undefined,
      onState: () => undefined,
    });
    await Promise.resolve();
    sock.setKeepalive(99);
    sock.setKeepalive(1);
    expect(delays.some((ms) => ms === 30_000)).toBe(true);
    expect(delays.some((ms) => ms === 15_000)).toBe(true);
    sock.close();
  });
});
