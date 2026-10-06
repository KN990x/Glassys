import { describe, expect, it, vi } from "vitest";

const seen: Record<string, unknown[]> = { create: [], prompt: [], abort: [], subscribe: [], get: [] };
let endStream: () => void = () => undefined;

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
          return {
            stream: (async function* () {
              yield { type: "session.idle", properties: { sessionID: "ses_1" } };
              await ended;
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

describe("opencode model ids", () => {
  it("splits provider/model and refuses a bare id with a readable error", async () => {
    const { parseModel } = await import("./index.js");
    expect(parseModel("anthropic/claude")).toEqual({ providerID: "anthropic", modelID: "claude" });
    expect(parseModel("default")).toBeUndefined();
    expect(() => parseModel("claude")).toThrow(/provider\/model/);
    expect(() => parseModel("anthropic/")).toThrow(/provider\/model/);
  });
});
