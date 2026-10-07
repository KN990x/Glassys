import { describe, expect, it } from "vitest";
import { createEventBatcher, HIDDEN_FLUSH_MS } from "./eventBatch";

function fakeScheduler(hidden = false) {
  const frames = new Map<number, () => void>();
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let next = 1;
  return {
    frames,
    timers,
    scheduler: {
      frame: (fn: () => void) => {
        frames.set(next, fn);
        return next++;
      },
      cancelFrame: (id: number) => void frames.delete(id),
      later: (fn: () => void, ms: number) => {
        timers.set(next, { fn, ms });
        return next++ as unknown as ReturnType<typeof setTimeout>;
      },
      cancelLater: (id: ReturnType<typeof setTimeout>) => void timers.delete(id as unknown as number),
      hidden: () => hidden,
    },
    runFrames() {
      for (const [id, fn] of [...frames]) {
        frames.delete(id);
        fn();
      }
    },
  };
}

describe("event batcher", () => {
  it("applies every event of a frame in one batch, in order", () => {
    const fake = fakeScheduler();
    const batches: number[][] = [];
    const b = createEventBatcher<number>((batch) => batches.push(batch), fake.scheduler);
    b.push(1);
    b.push(2);
    b.push(3);
    expect(fake.frames.size).toBe(1);
    fake.runFrames();
    b.push(4);
    fake.runFrames();
    expect(batches).toEqual([[1, 2, 3], [4]]);
  });

  it("uses a timer in a hidden tab", () => {
    const fake = fakeScheduler(true);
    const batches: number[][] = [];
    const b = createEventBatcher<number>((batch) => batches.push(batch), fake.scheduler);
    b.push(1);
    expect(fake.frames.size).toBe(0);
    expect([...fake.timers.values()][0]?.ms).toBe(HIDDEN_FLUSH_MS);
    [...fake.timers.values()][0]!.fn();
    expect(batches).toEqual([[1]]);
  });

  it("drops what is pending when a snapshot replaces the transcript", () => {
    const fake = fakeScheduler();
    const batches: number[][] = [];
    const b = createEventBatcher<number>((batch) => batches.push(batch), fake.scheduler);
    b.push(1);
    b.drop();
    expect(fake.frames.size).toBe(0);
    b.push(2);
    fake.runFrames();
    expect(batches).toEqual([[2]]);
  });

  it("still flushes when the tab is hidden after the frame was requested", () => {
    const fake = fakeScheduler();
    const batches: number[][] = [];
    const b = createEventBatcher<number>((batch) => batches.push(batch), fake.scheduler);
    b.push(1);
    expect(fake.frames.size).toBe(1);
    /* The tab goes to the background: no frame will ever run. The timer still does. */
    b.push(2);
    [...fake.timers.values()][0]!.fn();
    expect(batches).toEqual([[1, 2]]);
    expect(fake.frames.size).toBe(0);
  });
});
