import { describe, expect, it, vi } from "vitest";

const seen: Record<string, unknown[]> = { create: [], prompt: [], abort: [], subscribe: [], get: [] };
let endStream: () => void = () => undefined;
let hangPrompt = false;
/** Events the next prompt produces, before its session.idle. */
let turnEvents: unknown[] = [];
let pushEvent: ((e: unknown) => void) | null = null;

vi.mock("@opencode-ai/sdk", () => ({
  createOpencode: async () => ({
    server: { close: () => undefined },
    client: {
      session: {
        create: async (args: unknown) => {
          seen.create!.push(args);
          return { data: { id: "ses_1" } };
        },
        get: async (args: unknown) => {
          seen.get!.push(args);
          return { data: { id: "ses_1" } };
        },
        prompt: async (args: unknown) => {
          seen.prompt!.push(args);
          if (hangPrompt) await new Promise(() => undefined);
          for (const e of turnEvents) pushEvent?.(e);
          if (turnEvents.length) pushEvent?.({ type: "session.idle", properties: { sessionID: "ses_1" } });
          return { data: {} };
        },
        abort: async (args: unknown) => {
          seen.abort!.push(args);
          return {};
        },
      },
      event: {
        subscribe: async (args: unknown) => {
          seen.subscribe!.push(args);
          let finish!: () => void;
          const ended = new Promise<void>((r) => (finish = r));
          endStream = finish;
          const queued: unknown[] = [];
          let wake: (() => void) | null = null;
          pushEvent = (e) => {
            queued.push(e);
            wake?.();
          };
          return {
            stream: (async function* () {
              yield { type: "session.idle", properties: { sessionID: "ses_1" } };
              for (;;) {
                while (queued.length) yield queued.shift();
                const more = new Promise<"more">((r) => (wake = () => r("more")));
                if ((await Promise.race([ended.then(() => "end" as const), more])) === "end") return;
              }
            })(),
          };
        },
      },
    },
  }),
}));

const { opencodeAdapter } = await import("./index.js");
const opts = { cwd: "/srv/stack", model: "anthropic/claude", modelParams: [], storeDir: "/tmp/s", options: {} };

describe("opencode workspace directory", () => {
  it("names the workspace on create, subscribe and prompt", async () => {
    const session = await opencodeAdapter.create(opts);
    const run = await session.send("hi", () => undefined);
    await run.wait();
    expect(seen.create!.at(-1)).toMatchObject({ query: { directory: "/srv/stack" } });
    expect(seen.subscribe!.at(-1)).toMatchObject({ query: { directory: "/srv/stack" } });
    expect(seen.prompt!.at(-1)).toMatchObject({ path: { id: "ses_1" }, query: { directory: "/srv/stack" } });
    await session.dispose();
  });

  it("reports the session closed once the event stream ends", async () => {
    const session = await opencodeAdapter.resume("ses_1", opts);
    expect(seen.get!.at(-1)).toMatchObject({ query: { directory: "/srv/stack" } });
    expect(session.closed).toBe(false);
    endStream();
    await new Promise((r) => setTimeout(r, 20));
    // The first yielded event is buffered; the stream then ends.
    expect(session.closed).toBe(true);
    await session.dispose();
    await opencodeAdapter.shutdown?.();
  });
});

describe("opencode usage", () => {
  it("reports one usage line per run, summed over its assistant messages", async () => {
    const message = (id: string, input: number, output: number) => ({
      type: "message.updated",
      properties: {
        info: { id, sessionID: "ses_1", role: "assistant", time: { created: 1, completed: 2 }, tokens: { input, output, cache: {} } },
      },
    });
    turnEvents = [message("msg_a", 10, 2), message("msg_b", 5, 3)];
    try {
      const session = await opencodeAdapter.create(opts);
      const events: Array<{ type: string }> = [];
      const run = await session.send("hi", (e) => events.push(e as { type: string }));
      await run.wait();
      expect(events.filter((e) => e.type === "run.usage")).toEqual([{ type: "run.usage", inputTokens: 15, outputTokens: 5 }]);
      await session.dispose();
    } finally {
      turnEvents = [];
    }
  });
});

describe("opencode idle timeout", () => {
  it("aborts the prompt in the server before failing the run", async () => {
    const { setOpencodeIdleMsForTests } = await import("./index.js");
    setOpencodeIdleMsForTests(50);
    hangPrompt = true;
    try {
      const session = await opencodeAdapter.create(opts);
      const before = seen.abort!.length;
      const run = await session.send("hi", () => undefined);
      await expect(run.wait()).rejects.toThrow(/timed out/);
      expect(seen.abort!.length).toBe(before + 1);
      expect(seen.abort!.at(-1)).toMatchObject({ path: { id: "ses_1" } });
      await session.dispose();
    } finally {
      hangPrompt = false;
      setOpencodeIdleMsForTests();
    }
  });
});

describe("opencode model ids", () => {
  it("splits provider/model and refuses a bare id with a readable error", async () => {
    const { parseModel } = await import("./index.js");
    expect(parseModel("anthropic/claude")).toEqual({ providerID: "anthropic", modelID: "claude" });
    expect(parseModel("default")).toBeUndefined();
    expect(() => parseModel("claude")).toThrow(/provider\/model/);
    expect(() => parseModel("anthropic/")).toThrow(/provider\/model/);
  });
});
