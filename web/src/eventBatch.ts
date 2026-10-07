type Scheduler = {
  frame: (fn: () => void) => number;
  cancelFrame: (id: number) => void;
  later: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  cancelLater: (id: ReturnType<typeof setTimeout>) => void;
  hidden: () => boolean;
};

const browser: Scheduler = {
  frame: (fn) => requestAnimationFrame(fn),
  cancelFrame: (id) => cancelAnimationFrame(id),
  later: (fn, ms) => setTimeout(fn, ms),
  cancelLater: (id) => clearTimeout(id),
  hidden: () => document.hidden,
};

/** How often a hidden tab, which gets no animation frames, applies what it received. */
export const HIDDEN_FLUSH_MS = 250;

/**
 * Collects streamed events and hands them over once per frame. A stream is one WebSocket message
 * per token; applying each on its own re-rendered the whole chat screen per token.
 */
export function createEventBatcher<T>(apply: (batch: T[]) => void, scheduler: Scheduler = browser) {
  let pending: T[] = [];
  let frame: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    if (frame !== null) scheduler.cancelFrame(frame);
    if (timer !== null) scheduler.cancelLater(timer);
    frame = null;
    timer = null;
  };

  const flush = () => {
    cancel();
    const batch = pending;
    pending = [];
    if (batch.length) apply(batch);
  };

  return {
    push(event: T) {
      pending.push(event);
      if (frame !== null || timer !== null) return;
      /* The timer is armed with every frame too: a tab hidden after the frame was requested gets
         no frame, and without it everything would pile up until the tab came back. */
      timer = scheduler.later(flush, HIDDEN_FLUSH_MS);
      if (!scheduler.hidden()) frame = scheduler.frame(flush);
    },
    flush,
    /** Forget what is pending: a snapshot is about to replace it, or the screen is going away. */
    drop() {
      cancel();
      pending = [];
    },
  };
}
