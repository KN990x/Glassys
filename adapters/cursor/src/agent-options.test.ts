import { describe, expect, it, vi } from "vitest";

/* What the adapter hands the SDK: AGENTS.md's "local runtime only, always local.cwd, auto-run off
   is Auto-review, an empty key is left out" checked where it is built, not where it is hoped. */
const calls = vi.hoisted(() => ({ create: [] as unknown[], resume: [] as Array<[string, unknown]> }));

vi.mock("@cursor/sdk", () => {
  const agent = { agentId: "agent-1", close: async () => undefined };
  return {
    Agent: {
      create: async (opts: unknown) => {
        calls.create.push(opts);
        return agent;
      },
      resume: async (id: string, opts: unknown) => {
        calls.resume.push([id, opts]);
        return agent;
      },
    },
    Cursor: { auth: {}, models: { list: async () => [] } },
    JsonlLocalAgentStore: class {
      constructor(readonly dir: string) {}
    },
    CursorSdkError: class extends Error {},
  };
});

const { cursorAdapter } = await import("./index.js");

const base = { cwd: "/srv/ws", model: "grok-4.6", modelParams: [], storeDir: "/tmp/store" };

describe("cursor agent options", () => {
  it("always runs locally in the workspace, with Auto-review when auto-run is off", async () => {
    await cursorAdapter.create({ ...base, options: { autoRun: false, sandbox: true } });
    const opts = calls.create.at(-1) as Record<string, unknown> & { local: Record<string, unknown> };
    expect(opts.local).toMatchObject({ cwd: "/srv/ws", autoReview: true, sandboxOptions: { enabled: true } });
    expect(opts).not.toHaveProperty("apiKey");
    expect(opts).not.toHaveProperty("cloud");
  });

  it("passes a key only when there is one, and resumes with the same local options", async () => {
    await cursorAdapter.resume("agent-1", { ...base, apiKey: "", options: { autoRun: true } });
    const [id, opts] = calls.resume.at(-1)! as [string, Record<string, unknown> & { local: Record<string, unknown> }];
    expect(id).toBe("agent-1");
    expect(opts).not.toHaveProperty("apiKey");
    expect(opts.local).toMatchObject({ cwd: "/srv/ws", autoReview: false });
    await cursorAdapter.create({ ...base, apiKey: "k-test", options: {} });
    expect(calls.create.at(-1)).toMatchObject({ apiKey: "k-test" });
  });
});
