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
    // A function, not an arrow: the socket is created with `new`, and since Vitest 4 a
    // mock built from an arrow function cannot be constructed, just like the arrow itself.
    const WS = Object.assign(
      vi.fn(function () {
        return new FakeSocket();
      }),
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

describe("socket reconnect", () => {
  type Listener = (ev?: { data: string }) => void;
  class FakeSocket {
    static all: FakeSocket[] = [];
    readyState = 0;
    listeners = new Map<string, Listener[]>();
    constructor() {
      FakeSocket.all.push(this);
    }
    addEventListener(type: string, fn: Listener) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
    }
    emit(type: string, ev?: { data: string }) {
      for (const fn of this.listeners.get(type) ?? []) fn(ev);
    }
    open() {
      this.readyState = 1;
      this.emit("open");
    }
    message(msg: object) {
      this.emit("message", { data: JSON.stringify(msg) });
    }
    drop() {
      this.readyState = 3;
      this.emit("close");
    }
    send() {
      /* ignore */
    }
    close() {
      this.readyState = 3;
    }
  }

  async function setup() {
    FakeSocket.all = [];
    vi.useFakeTimers();
    const WS = Object.assign(
      vi.fn(function () {
        return new FakeSocket();
      }),
      { OPEN: 1, CONNECTING: 0, CLOSING: 2, CLOSED: 3 },
    );
    vi.stubGlobal("WebSocket", WS);
    vi.stubGlobal("location", { protocol: "http:", host: "127.0.0.1:8787" });
    const { openSocket } = await import("./socket");
    const states: string[] = [];
    const sock = openSocket({ onEvent: () => undefined, onState: (s) => states.push(s) });
    return { sock, states, WS };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("reports reconnecting as soon as the socket drops", async () => {
    const { sock, states } = await setup();
    FakeSocket.all[0]!.open();
    FakeSocket.all[0]!.message({ type: "auth.ok" });
    FakeSocket.all[0]!.drop();
    expect(states.at(-1)).toBe("reconnecting");
    sock.close();
  });

  it("keeps backing off until the gateway authenticates", async () => {
    const { sock } = await setup();
    FakeSocket.all[0]!.open();
    FakeSocket.all[0]!.drop();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeSocket.all).toHaveLength(2);
    FakeSocket.all[1]!.open();
    FakeSocket.all[1]!.drop();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(FakeSocket.all).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSocket.all).toHaveLength(3);
    FakeSocket.all[2]!.open();
    FakeSocket.all[2]!.message({ type: "auth.ok" });
    FakeSocket.all[2]!.drop();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeSocket.all).toHaveLength(4);
    sock.close();
  });

  it("does not reconnect after close() while a retry is pending", async () => {
    const { sock, WS } = await setup();
    FakeSocket.all[0]!.drop();
    sock.close();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(WS).toHaveBeenCalledTimes(1);
  });
});
