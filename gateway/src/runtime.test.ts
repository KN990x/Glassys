import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { pendingRun, type Adapter, type AdapterSession } from "@glassys/adapter-contract";
import { defaultConfig, type ServerMessage } from "@glassys/protocol";

const control = vi.hoisted(() => {
  let release: (() => void) | null = null;
  let sendRelease: (() => void) | null = null;
  return {
    held: Promise.resolve(),
    sendHeld: Promise.resolve(),
    hold() {
      this.held = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    go() {
      release?.();
      release = null;
      this.held = Promise.resolve();
    },
    holdSend() {
      this.sendHeld = new Promise<void>((resolve) => {
        sendRelease = resolve;
      });
    },
    goSend() {
      sendRelease?.();
      sendRelease = null;
      this.sendHeld = Promise.resolve();
    },
  };
});

const fakeAdapter: Adapter = {
  id: "cursor",
  displayName: "Fake",
  capabilities: {
    models: true,
    sandbox: false,
    settingSources: false,
    autoRun: false,
    cancel: true,
    resume: true,
    discover: false,
    toolConfirmation: "none",
    auth: { kind: "api-key", envNames: [] },
  },
  async listModels() {
    return { models: [{ id: "m", displayName: "M" }], source: "live" as const };
  },
  async create(): Promise<AdapterSession> {
    return {
      agentId: "agent-1",
      async send(text, onEvent) {
        await control.sendHeld;
        return pendingRun(`run-${text}`, async ({ isCancelled }) => {
          onEvent({ type: "text.delta", text: `echo:${text}` } as ServerMessage);
          await control.held;
          if (isCancelled()) return "cancelled";
          return "finished";
        });
      },
      async dispose() {
        /* noop */
      },
    };
  },
  async resume(_id, opts) {
    return this.create(opts);
  },
};

vi.mock("./adapters.js", () => ({
  getAdapter: () => fakeAdapter,
  tryGetAdapter: () => fakeAdapter,
  listAdapters: () => [fakeAdapter],
  probeAdapter: async () => ({ ok: true as const }),
  UnknownAdapterError: class UnknownAdapterError extends Error {},
}));

async function waitUntil(fn: () => boolean | Promise<boolean>, ms = 2000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("timeout");
}

describe("runtime queue", () => {
  let dir: string;

  beforeEach(async () => {
    control.go();
    control.goSend();
    dir = await mkdtemp(join(tmpdir(), "glassys-rt-"));
    process.env.GLASSYS_DATA_DIR = dir;
    const cfg = defaultConfig();
    cfg.onboarding.completed = true;
    cfg.agent.cwd = dir;
    cfg.agent.adapter = "cursor";
    await writeFile(join(dir, "config.yaml"), YAML.stringify(cfg), "utf8");
  });

  afterEach(async () => {
    control.go();
    control.goSend();
    const { shutdownRuntime } = await import("./runtime.js");
    await shutdownRuntime();
  });

  it("rejects messages before onboarding is complete", async () => {
    const cfg = defaultConfig();
    cfg.agent.cwd = dir;
    await writeFile(join(dir, "config.yaml"), YAML.stringify(cfg), "utf8");
    const { enqueueMessage, readTranscript } = await import("./runtime.js");
    await enqueueMessage("hello");
    const events = await readTranscript();
    expect(events.some((e) => e.type === "run.error")).toBe(true);
    expect(events.some((e) => e.type === "user.message")).toBe(false);
  });

  it("rejects completing onboarding without a valid cwd", async () => {
    const cfg = defaultConfig();
    await writeFile(join(dir, "config.yaml"), YAML.stringify(cfg), "utf8");
    const { cwdErrorInPatch } = await import("./runtime.js");
    expect(await cwdErrorInPatch({ onboarding: { completed: true } })).toMatch(/Workspace path/);
    expect(await cwdErrorInPatch({ onboarding: { completed: true }, agent: { cwd: dir } })).toBeNull();
  });

  it("queues a second message while the first run is in flight", async () => {
    control.hold();
    const { hub } = await import("./hub.js");
    const live: string[] = [];
    const orig = hub.broadcast.bind(hub);
    hub.broadcast = (msg) => {
      live.push(msg.type);
      orig(msg);
    };
    try {
      const { enqueueMessage, readTranscript, drainEmit } = await import("./runtime.js");
      const first = enqueueMessage("one");
      await waitUntil(() => live.includes("run.start"));
      await enqueueMessage("two");
      await drainEmit();
      expect(live).toContain("run.queued");
      const mid = await readTranscript();
      expect(mid.filter((e) => e.type === "user.message")).toHaveLength(2);
      control.go();
      await first;
      await waitUntil(async () => (await readTranscript()).some((e) => e.type === "text.delta" && "text" in e && e.text === "echo:two"));
      await drainEmit();
      const done = await readTranscript();
      expect(done.filter((e) => e.type === "run.done").length).toBeGreaterThanOrEqual(1);
    } finally {
      hub.broadcast = orig;
    }
  });

  it("cancels the current run and still runs the queued follow-up", async () => {
    control.hold();
    const { enqueueMessage, cancelRun, readTranscript, drainEmit } = await import("./runtime.js");
    void enqueueMessage("one");
    await waitUntil(async () => (await readTranscript()).some((e) => e.type === "text.delta"));
    await enqueueMessage("two");
    await cancelRun();
    control.go();
    await waitUntil(async () => (await readTranscript()).some((e) => e.type === "text.delta" && "text" in e && e.text === "echo:two"));
    await drainEmit();
    const events = await readTranscript();
    expect(events.some((e) => e.type === "run.cancelled")).toBe(true);
  });

  it("does not send the follow-up until the cancelled run's wait() resolves", async () => {
    let waitFinished = 0;
    let cancelled = false;
    const origCreate = fakeAdapter.create.bind(fakeAdapter);
    fakeAdapter.create = async () => ({
      agentId: "agent-wait",
      async send(text, onEvent) {
        if (waitFinished < 1 && text === "two") throw new Error("send before wait");
        return {
          id: `run-${text}`,
          cancel: async () => {
            cancelled = true;
          },
          wait: async () => {
            await control.held;
            waitFinished += 1;
            if (text === "one") onEvent({ type: "text.delta", text: "echo:one" } as ServerMessage);
            else onEvent({ type: "text.delta", text: "echo:two" } as ServerMessage);
            return cancelled && text === "one" ? "cancelled" : "finished";
          },
        };
      },
      async dispose() {
        /* noop */
      },
    });
    const { hub } = await import("./hub.js");
    const live: string[] = [];
    const origBroadcast = hub.broadcast.bind(hub);
    hub.broadcast = (msg) => {
      live.push(msg.type);
      origBroadcast(msg);
    };
    try {
      control.hold();
      const { enqueueMessage, cancelRun, readTranscript } = await import("./runtime.js");
      void enqueueMessage("one");
      await waitUntil(() => live.includes("run.start"));
      await enqueueMessage("two");
      await cancelRun();
      expect(waitFinished).toBe(0);
      expect((await readTranscript()).some((e) => e.type === "text.delta" && "text" in e && e.text === "echo:two")).toBe(false);
      control.go();
      await waitUntil(async () => (await readTranscript()).some((e) => e.type === "text.delta" && "text" in e && e.text === "echo:two"));
      expect(waitFinished).toBeGreaterThanOrEqual(1);
    } finally {
      hub.broadcast = origBroadcast;
      fakeAdapter.create = origCreate;
    }
  });

  it("cancels a run that is still inside send()", async () => {
    control.holdSend();
    const { enqueueMessage, cancelRun, readTranscript, drainEmit } = await import("./runtime.js");
    void enqueueMessage("one");
    await waitUntil(async () => (await readTranscript()).some((e) => e.type === "user.message"));
    await cancelRun();
    control.goSend();
    await waitUntil(async () => (await readTranscript()).some((e) => e.type === "run.cancelled"));
    await drainEmit();
    const events = await readTranscript();
    expect(events.some((e) => e.type === "run.done")).toBe(false);
  });

  it("does not clear the transcript until an in-flight run idles after identity change", async () => {
    control.hold();
    const { enqueueMessage, applyConfigPatch, readTranscript, drainEmit } = await import("./runtime.js");
    void enqueueMessage("one");
    await waitUntil(async () => (await readTranscript()).some((e) => e.type === "text.delta"));
    const other = await mkdtemp(join(tmpdir(), "glassys-cwd-"));
    await applyConfigPatch({ agent: { cwd: other } });
    expect((await readTranscript()).length).toBeGreaterThan(0);
    control.go();
    await waitUntil(async () => (await readTranscript()).length === 0);
    await drainEmit();
    expect(await readTranscript()).toEqual([]);
  });

  it("keeps draining the queue when a run throws", async () => {
    const origCreate = fakeAdapter.create.bind(fakeAdapter);
    let boom = true;
    fakeAdapter.create = async (opts) => {
      const session = await origCreate(opts);
      const origSend = session.send.bind(session);
      return {
        ...session,
        async send(text, onEvent, sendOpts) {
          if (boom) {
            boom = false;
            throw new Error("boom");
          }
          return origSend(text, onEvent, sendOpts);
        },
      };
    };
    try {
      const { enqueueMessage, readTranscript, drainEmit } = await import("./runtime.js");
      await enqueueMessage("one");
      await enqueueMessage("two");
      await waitUntil(async () => (await readTranscript()).some((e) => e.type === "text.delta" && "text" in e && e.text === "echo:two"));
      await drainEmit();
      const events = await readTranscript();
      expect(events.some((e) => e.type === "run.error")).toBe(true);
    } finally {
      fakeAdapter.create = origCreate;
    }
  });

  it("clears the transcript when adapter identity changes", async () => {
    const { enqueueMessage, applyConfigPatch, readTranscript, drainEmit } = await import("./runtime.js");
    await enqueueMessage("one");
    await waitUntil(async () => (await readTranscript()).some((e) => e.type === "run.done"));
    await drainEmit();
    expect((await readTranscript()).length).toBeGreaterThan(0);
    const other = await mkdtemp(join(tmpdir(), "glassys-cwd-"));
    await applyConfigPatch({ agent: { cwd: other } });
    expect(await readTranscript()).toEqual([]);
  });

  it("does not wipe a new thread that starts after an identity change", async () => {
    control.hold();
    const { enqueueMessage, applyConfigPatch, readTranscript, drainEmit } = await import("./runtime.js");
    void enqueueMessage("one");
    await waitUntil(async () => (await readTranscript()).some((e) => e.type === "text.delta"));
    const other = await mkdtemp(join(tmpdir(), "glassys-cwd-"));
    await applyConfigPatch({ agent: { cwd: other } });
    await enqueueMessage("two");
    control.go();
    await waitUntil(async () =>
      (await readTranscript()).some((e) => e.type === "text.delta" && "text" in e && e.text === "echo:two"),
    );
    await drainEmit();
    const events = await readTranscript();
    expect(events.some((e) => e.type === "user.message" && "text" in e && e.text === "two")).toBe(true);
    expect(events.some((e) => e.type === "text.delta" && "text" in e && e.text === "echo:two")).toBe(true);
    expect(events.some((e) => e.type === "user.message" && "text" in e && e.text === "one")).toBe(false);
  });

  it("wipes the transcript when resume fails so the UI does not keep an amnesiac thread", async () => {
    const { PROFILE_ID } = await import("@glassys/protocol");
    const { saveState } = await import("./state.js");
    const { appendTranscript } = await import("./transcript.js");
    await saveState({ profileId: PROFILE_ID, agentId: "stale-agent" });
    await appendTranscript({ type: "user.message", text: "stale" });
    await appendTranscript({ type: "text.delta", text: "old reply" });
    const origResume = fakeAdapter.resume;
    fakeAdapter.resume = async () => {
      throw new Error("resume broken");
    };
    try {
      const { enqueueMessage, readTranscript, drainEmit } = await import("./runtime.js");
      await enqueueMessage("fresh");
      await waitUntil(async () => (await readTranscript()).some((e) => e.type === "run.done"));
      await drainEmit();
      const events = await readTranscript();
      expect(events.some((e) => e.type === "user.message" && "text" in e && e.text === "stale")).toBe(false);
      expect(events.some((e) => e.type === "text.delta" && "text" in e && e.text === "old reply")).toBe(false);
      expect(events.some((e) => e.type === "user.message" && "text" in e && e.text === "fresh")).toBe(true);
    } finally {
      fakeAdapter.resume = origResume;
    }
  });

  it("does not call resume or wipe the transcript when the adapter declares resume: false", async () => {
    const { PROFILE_ID } = await import("@glassys/protocol");
    const { saveState } = await import("./state.js");
    const { appendTranscript } = await import("./transcript.js");
    await saveState({ profileId: PROFILE_ID, agentId: "stale-agent" });
    await appendTranscript({ type: "user.message", text: "stale" });
    const origResume = fakeAdapter.resume;
    fakeAdapter.capabilities.resume = false;
    fakeAdapter.resume = async () => {
      throw new Error("resume must not run");
    };
    try {
      const { enqueueMessage, readTranscript, drainEmit } = await import("./runtime.js");
      await enqueueMessage("fresh");
      await waitUntil(async () => (await readTranscript()).some((e) => e.type === "run.done"));
      await drainEmit();
      const events = await readTranscript();
      expect(events.some((e) => e.type === "user.message" && "text" in e && e.text === "stale")).toBe(true);
      expect(events.some((e) => e.type === "user.message" && "text" in e && e.text === "fresh")).toBe(true);
    } finally {
      fakeAdapter.capabilities.resume = true;
      fakeAdapter.resume = origResume;
    }
  });

  it("keeps the transcript when resume fails and create also fails", async () => {
    const { PROFILE_ID } = await import("@glassys/protocol");
    const { saveState } = await import("./state.js");
    const { appendTranscript, readTranscript } = await import("./transcript.js");
    await saveState({ profileId: PROFILE_ID, agentId: "stale-agent" });
    await appendTranscript({ type: "user.message", text: "stale" });
    const origResume = fakeAdapter.resume;
    const origCreate = fakeAdapter.create;
    fakeAdapter.resume = async () => {
      throw new Error("resume broken");
    };
    fakeAdapter.create = async () => {
      throw new Error("create broken");
    };
    try {
      const { enqueueMessage, readTranscript, drainEmit } = await import("./runtime.js");
      await enqueueMessage("fresh");
      await waitUntil(async () => (await readTranscript()).some((e) => e.type === "run.error"));
      await drainEmit();
      const events = await readTranscript();
      expect(events.some((e) => e.type === "user.message" && "text" in e && e.text === "stale")).toBe(true);
    } finally {
      fakeAdapter.resume = origResume;
      fakeAdapter.create = origCreate;
    }
  });

  it("does not throw when adapter cancel fails", async () => {
    control.hold();
    const origCreate = fakeAdapter.create;
    fakeAdapter.create = async () => ({
      agentId: "agent-1",
      async send(text, onEvent) {
        return {
          id: `run-${text}`,
          cancel: async () => {
            throw new Error("cannot cancel");
          },
          wait: async () => {
            onEvent({ type: "text.delta", text: `echo:${text}` } as ServerMessage);
            await control.held;
            return "finished";
          },
        };
      },
      async dispose() {
        /* noop */
      },
    });
    try {
      const { enqueueMessage, cancelRun, readTranscript, drainEmit } = await import("./runtime.js");
      void enqueueMessage("one");
      await waitUntil(async () => (await readTranscript()).some((e) => e.type === "text.delta"));
      await expect(cancelRun()).resolves.toBeUndefined();
      control.go();
      await waitUntil(async () => (await readTranscript()).some((e) => e.type === "run.cancelled"));
      await drainEmit();
      const events = await readTranscript();
      expect(events.some((e) => e.type === "run.error")).toBe(false);
      expect(events.some((e) => e.type === "run.cancelled")).toBe(true);
    } finally {
      fakeAdapter.create = origCreate;
    }
  });

  it("keeps currentRun when a follow-up is enqueued as the queue goes idle", async () => {
    control.hold();
    const { hub } = await import("./hub.js");
    const sessions: boolean[] = [];
    const orig = hub.broadcast.bind(hub);
    hub.broadcast = (msg) => {
      if (msg.type === "session") sessions.push(msg.busy);
      orig(msg);
    };
    try {
      const { enqueueMessage, cancelRun, readTranscript, drainEmit } = await import("./runtime.js");
      const first = enqueueMessage("one");
      await waitUntil(async () => (await readTranscript()).some((e) => e.type === "text.delta"));
      control.go();
      await first;
      await enqueueMessage("two");
      await waitUntil(async () =>
        (await readTranscript()).some((e) => e.type === "text.delta" && "text" in e && e.text === "echo:two"),
      );
      await drainEmit();
      expect(sessions.filter((busy) => busy).length).toBeGreaterThan(0);
      await cancelRun();
    } finally {
      hub.broadcast = orig;
    }
  });
});
