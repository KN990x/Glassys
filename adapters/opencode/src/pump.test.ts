import { describe, expect, it } from "vitest";
import { EventPump } from "./pump.js";

async function* hang(): AsyncGenerator<unknown> {
  await new Promise(() => undefined);
}

describe("EventPump", () => {
  it("returns as soon as the abort signal fires", async () => {
    const pump = new EventPump(hang());
    const ac = new AbortController();
    const started = Date.now();
    const pending = pump.next(180_000, ac.signal);
    ac.abort();
    const result = await pending;
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(result.done).toBe(true);
  });

  it("abort() ends waiters without waiting for the stream", async () => {
    const pump = new EventPump(hang());
    const pending = pump.next(180_000);
    pump.abort();
    const result = await pending;
    expect(result.done).toBe(true);
  });

  it("times out without an event when the stream is idle", async () => {
    const pump = new EventPump(hang());
    const result = await pump.next(30);
    expect(result.event).toBeUndefined();
    expect(result.done).toBe(false);
    pump.abort();
  });

  it("drain() returns buffered events without waiting", async () => {
    async function* once() {
      yield { type: "a" };
      yield { type: "b" };
    }
    const pump = new EventPump(once());
    const seen: unknown[] = [];
    for (let i = 0; i < 50 && seen.length < 2; i++) {
      seen.push(...pump.drain());
      if (seen.length < 2) await new Promise((r) => setTimeout(r, 5));
    }
    expect(seen).toEqual([{ type: "a" }, { type: "b" }]);
    expect(pump.drain()).toEqual([]);
    pump.abort();
  });
});
