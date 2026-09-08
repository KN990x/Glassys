export class EventPump {
  private buf: unknown[] = [];
  private waiters: Array<() => void> = [];
  private ended = false;
  private readonly abortCtl = new AbortController();

  constructor(stream: AsyncIterable<unknown>) {
    void (async () => {
      try {
        for await (const ev of stream) {
          if (this.abortCtl.signal.aborted) break;
          this.buf.push(ev);
          this.waiters.shift()?.();
        }
      } catch {
        /* subscribe ended */
      } finally {
        this.ended = true;
        while (this.waiters.length) this.waiters.shift()?.();
      }
    })();
  }

  abort(): void {
    this.abortCtl.abort();
    this.ended = true;
    this.buf = [];
    while (this.waiters.length) this.waiters.shift()?.();
  }

  drain(): unknown[] {
    return this.buf.splice(0, this.buf.length);
  }

  async next(ms: number, signal?: AbortSignal): Promise<{ event?: unknown; done: boolean }> {
    if (this.buf.length) return { event: this.buf.shift(), done: false };
    if (this.ended || signal?.aborted) return { done: true };
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", done);
        const i = this.waiters.indexOf(done);
        if (i >= 0) this.waiters.splice(i, 1);
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.waiters.push(done);
      if (!signal) return;
      if (signal.aborted) {
        done();
        return;
      }
      signal.addEventListener("abort", done);
    });
    if (this.buf.length) return { event: this.buf.shift(), done: false };
    return { done: this.ended || Boolean(signal?.aborted) };
  }
}
