import { describe, expect, it, vi } from "vitest";

/* The real client answers failures with `{ error }` instead of throwing. */
const replies: unknown[] = [];
let streamEvents: unknown[] = [];
let promptResult: unknown = { data: {} };
/* Events reach the stream only once a prompt was sent, as they do on a real server. */
let prompted!: () => void;
let promptSent = new Promise<void>((r) => (prompted = r));

vi.mock("@opencode-ai/sdk", () => ({
  createOpencode: async () => ({
    server: { close: () => undefined },
    client: {
      postSessionIdPermissionsPermissionId: async (args: unknown) => {
        replies.push(args);
        return { data: true };
      },
      session: {
        create: async () => ({ data: { id: "ses_1" } }),
        get: async () => ({ error: { name: "NotFoundError", data: { message: "Session not found" } } }),
        prompt: async () => {
          prompted();
          await new Promise((r) => setTimeout(r, 20));
          return promptResult;
        },
        abort: async () => ({ data: true }),
      },
      event: {
        subscribe: async () => ({
          stream: (async function* () {
            await promptSent;
            promptSent = new Promise<void>((r) => (prompted = r));
            for (const event of streamEvents) yield event;
            await new Promise(() => undefined);
          })(),
        }),
      },
      config: {
        providers: async () => ({ data: { providers: [], default: {} } }),
      },
    },
  }),
}));

const { opencodeAdapter, checked } = await import("./index.js");
const opts = { cwd: "/srv/w", model: "anthropic/claude", modelParams: [], storeDir: "/tmp/s", options: {} };

describe("opencode error results", () => {
  it("turns an { error } result into a thrown error", async () => {
    await expect(checked(Promise.resolve({ error: { name: "APIError", data: { message: "nope" } } }))).rejects.toThrow("nope");
    await expect(checked(Promise.resolve({ data: 1 }))).resolves.toEqual({ data: 1 });
  });

  it("refuses to resume a session the server no longer has", async () => {
    await expect(opencodeAdapter.resume("ses_gone", opts)).rejects.toThrow(/could not be resumed: Session not found/);
  });

  it("fails a run whose prompt was rejected instead of finishing empty", async () => {
    streamEvents = [];
    promptResult = { error: { name: "ProviderModelNotFoundError", data: { message: "Model not found: x/y" } } };
    const session = await opencodeAdapter.create(opts);
    const run = await session.send("hi", () => undefined);
    await expect(run.wait()).rejects.toThrow(/Model not found/);
    await session.dispose();
  });

  it("answers a permission request with reject instead of hanging", async () => {
    promptResult = { data: {} };
    streamEvents = [
      { type: "permission.updated", properties: { id: "per_1", sessionID: "ses_1", type: "bash", title: "rm", messageID: "m", metadata: {}, time: { created: 1 } } },
      { type: "message.part.updated", properties: { part: { id: "p", sessionID: "ses_1", messageID: "m", type: "text", text: "ok" } } },
      { type: "session.idle", properties: { sessionID: "ses_1" } },
    ];
    const session = await opencodeAdapter.create(opts);
    const run = await session.send("hi", () => undefined);
    await expect(run.wait()).resolves.toBe("finished");
    expect(replies.at(-1)).toMatchObject({ path: { id: "ses_1", permissionID: "per_1" }, body: { response: "reject" } });
    await session.dispose();
  });

  it("reports no providers as a fallback, never a live list of config keys", async () => {
    await expect(opencodeAdapter.listModels(undefined, "/srv/w")).resolves.toMatchObject({ source: "fallback" });
  });
});
