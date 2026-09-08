import { randomUUID } from "node:crypto";
import { createOpencode } from "@opencode-ai/sdk";
import {
  AdapterError,
  asRecord,
  errorMessage,
  pendingRun,
  promptWithAttachments,
  requireHostCommand,
  type Adapter,
  type AdapterCreateOptions,
  type AdapterSession,
  type PromptAttachment,
} from "@glassys/adapter-contract";
import { type AgentConfig, type ModelCatalogItem } from "@glassys/protocol";
import { isOpencodeError, isOpencodeIdle, isStaleOpencodeIdle, mapOpencodeEvent, opencodeSessionId } from "./mapper.js";
import { EventPump } from "./pump.js";

export { EventPump } from "./pump.js";

const OPENCODE_IDLE_MS = 600_000;
const OPENCODE_DRAIN_MS = 2_000;

const FALLBACK: ModelCatalogItem[] = [{ id: "default", displayName: "Default (OpenCode config)" }];

type OcBundle = Awaited<ReturnType<typeof createOpencode>>;
type OcClient = OcBundle["client"];

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

let envLock = Promise.resolve();
let sharedServer: Promise<OcBundle> | null = null;
let sharedKey = "";

async function withApiKey<T>(apiKey: string | undefined, fn: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const prev = envLock;
  envLock = new Promise<void>((r) => {
    release = r;
  });
  await prev;
  try {
    if (!apiKey) return await fn();
    const old = process.env.OPENCODE_API_KEY;
    process.env.OPENCODE_API_KEY = apiKey;
    try {
      return await fn();
    } finally {
      if (old === undefined) delete process.env.OPENCODE_API_KEY;
      else process.env.OPENCODE_API_KEY = old;
    }
  } finally {
    release();
  }
}

async function getSharedServer(apiKey?: string): Promise<OcBundle> {
  const key = apiKey ?? "";
  if (sharedServer && sharedKey !== key) await closeSharedServer();
  if (!sharedServer) {
    sharedKey = key;
    sharedServer = withApiKey(apiKey, () =>
      createOpencode({ hostname: "127.0.0.1", port: 0, timeout: 20_000 }),
    ).catch((err) => {
      sharedServer = null;
      sharedKey = "";
      throw err;
    });
  }
  return sharedServer;
}

function sessionIdFrom(created: unknown): string | undefined {
  const rec = asRecord(created);
  if (!rec) return undefined;
  return str(rec.id) || str(asRecord(rec.data)?.id) || str(asRecord(rec.session)?.id);
}

function parseModel(model: string): unknown {
  if (!model || model === "default") return undefined;
  const slash = model.indexOf("/");
  if (slash > 0) return { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) };
  return { modelID: model };
}

async function eventStream(client: OcClient): Promise<AsyncIterable<unknown>> {
  const sub = await client.event.subscribe();
  if (sub && typeof sub === "object" && "stream" in sub) {
    return (sub as { stream: AsyncIterable<unknown> }).stream;
  }
  return sub as AsyncIterable<unknown>;
}

function unwrapData(raw: unknown): unknown {
  const rec = asRecord(raw);
  if (!rec) return raw;
  if (rec.data !== undefined) return rec.data;
  return raw;
}

function addProviderModels(out: ModelCatalogItem[], providerId: string, modelsRaw: unknown): void {
  const nested = asRecord(modelsRaw);
  if (nested) {
    for (const [modelId, meta] of Object.entries(nested)) {
      const name = str(asRecord(meta)?.name) || `${providerId}/${modelId}`;
      out.push({ id: `${providerId}/${modelId}`, displayName: name });
    }
    return;
  }
  if (!Array.isArray(modelsRaw)) return;
  for (const item of modelsRaw) {
    if (typeof item === "string" && item) {
      out.push({ id: `${providerId}/${item}`, displayName: item });
      continue;
    }
    const rec = asRecord(item);
    const modelId = str(rec?.id) || str(rec?.modelID);
    if (!modelId) continue;
    out.push({ id: `${providerId}/${modelId}`, displayName: str(rec?.name) || modelId });
  }
}

export function collectModels(raw: unknown): ModelCatalogItem[] {
  const models: ModelCatalogItem[] = [];
  const unwrapped = unwrapData(raw);
  const rec = asRecord(unwrapped);
  const list = Array.isArray(unwrapped)
    ? unwrapped
    : Array.isArray(rec?.providers)
      ? rec.providers
      : Array.isArray(rec?.provider)
        ? rec.provider
        : null;
  if (list) {
    for (const item of list) {
      const pr = asRecord(item);
      if (!pr) continue;
      const providerId = str(pr.id) || str(pr.providerID) || str(pr.name) || "provider";
      addProviderModels(models, providerId, pr.models);
    }
    return models;
  }
  const map = rec ? ((rec.provider ?? rec.providers ?? rec) as unknown) : unwrapped;
  const mapRec = asRecord(map) ?? {};
  for (const [providerId, val] of Object.entries(mapRec)) {
    if (providerId === "provider" || providerId === "providers" || providerId === "data") continue;
    addProviderModels(models, providerId, asRecord(val)?.models ?? val);
  }
  return models;
}

function foreignSession(event: unknown, sessionId: string): boolean {
  const sid = opencodeSessionId(event);
  return Boolean(sid && sid !== sessionId);
}

class OpencodeSession implements AdapterSession {
  private tools = new Map<string, string>();
  private snapshots = new Map<string, string>();

  constructor(
    readonly agentId: string,
    private client: OcClient,
    private model: string,
    private pump: EventPump,
  ) {}

  static async connect(opts: AdapterCreateOptions, sessionId?: string): Promise<OpencodeSession> {
    let bundle: OcBundle;
    try {
      bundle = await getSharedServer(opts.apiKey);
    } catch (err) {
      throw new AdapterError(
        `OpenCode server failed to start: ${errorMessage(err)}. Install the OpenCode CLI on this host.`,
        "startup",
      );
    }
    try {
      let id = sessionId;
      if (id) {
        const get = (bundle.client.session as { get?: (args: unknown) => Promise<unknown> }).get;
        if (!get) {
          id = undefined;
        } else {
          try {
            await get({
              path: { id },
              query: { directory: opts.cwd },
            });
          } catch (err) {
            throw new AdapterError(`OpenCode session could not be resumed: ${errorMessage(err)}`, "startup");
          }
        }
      }
      if (!id) {
        const created = await bundle.client.session.create({
          body: { title: "Glassys" },
          query: { directory: opts.cwd },
        } as never);
        id = sessionIdFrom(created);
      }
      if (!id) throw new AdapterError("OpenCode did not return a session id", "startup");
      const pump = new EventPump(await eventStream(bundle.client));
      return new OpencodeSession(id, bundle.client, opts.model, pump);
    } catch (err) {
      throw err instanceof AdapterError ? err : new AdapterError(errorMessage(err), "startup");
    }
  }

  async send(
    text: string,
    onEvent: Parameters<AdapterSession["send"]>[1],
    sendOpts?: { model?: string; attachments?: PromptAttachment[] },
  ) {
    if (sendOpts?.model) this.model = sendOpts.model;
    const runId = randomUUID();
    const model = parseModel(this.model);
    const promptText = promptWithAttachments(text, sendOpts?.attachments);
    return pendingRun(runId, async ({ signal, isCancelled }) => {
      this.pump.drain();
      const prompt = this.client.session.prompt({
        path: { id: this.agentId },
        body: {
          parts: [{ type: "text", text: promptText }],
          ...(model ? { model } : {}),
        },
      } as never);
      let promptSettled = false;
      let idle = false;
      let failed = false;
      let sawRunEvent = false;
      void prompt.finally(() => {
        promptSettled = true;
      });
      try {
        while (!isCancelled()) {
          const waitMs = promptSettled ? OPENCODE_DRAIN_MS : OPENCODE_IDLE_MS;
          const next = await this.pump.next(waitMs, signal);
          if (isCancelled()) break;
          if (next.event) {
            const mapped = mapOpencodeEvent(next.event, this.tools, this.snapshots, this.agentId);
            if (mapped.length) sawRunEvent = true;
            for (const ev of mapped) {
              onEvent(ev);
              if (ev.type === "run.error") failed = true;
            }
            if (isOpencodeError(next.event) && !foreignSession(next.event, this.agentId)) failed = true;
            if (isOpencodeIdle(next.event) && !foreignSession(next.event, this.agentId)) {
              if (isStaleOpencodeIdle(next.event, sawRunEvent, promptSettled)) continue;
              idle = true;
              break;
            }
            if (failed) break;
            continue;
          }
          if (next.done || promptSettled) break;
          throw new AdapterError("OpenCode timed out waiting for run events", "run");
        }
        for (const leftover of this.pump.drain()) {
          if (isCancelled()) break;
          for (const ev of mapOpencodeEvent(leftover, this.tools, this.snapshots, this.agentId)) {
            onEvent(ev);
            if (ev.type === "run.error") failed = true;
          }
          if (isOpencodeError(leftover) && !foreignSession(leftover, this.agentId)) failed = true;
        }
        if (isCancelled()) {
          try {
            await this.client.session.abort({ path: { id: this.agentId } } as never);
          } catch {
            /* ignore */
          }
          return "cancelled";
        }
        try {
          await prompt;
        } catch (err) {
          if (!idle && !failed) throw new AdapterError(errorMessage(err), "run");
        }
        return failed ? "error" : "finished";
      } catch (err) {
        if (isCancelled()) return "cancelled";
        throw err;
      }
    });
  }

  async dispose(): Promise<void> {
    this.pump.abort();
  }
}

async function closeSharedServer(): Promise<void> {
  const pending = sharedServer;
  sharedServer = null;
  sharedKey = "";
  if (!pending) return;
  try {
    const bundle = await pending;
    bundle.server.close();
  } catch {
    /* ignore */
  }
}

export const opencodeAdapter: Adapter = {
  id: "opencode",
  displayName: "OpenCode",
  description: "sst/OpenCode local server. Models come from the operator's configured providers.",
  capabilities: {
    models: true,
    sandbox: false,
    settingSources: false,
    autoRun: false,
    cancel: true,
    resume: true,
    discover: false,
    toolConfirmation: "none",
    attachments: false,
    auth: { kind: "cli-binary", envNames: ["OPENCODE_API_KEY"] },
    defaultModel: { id: "default", params: [] },
    liveCatalog: true,
  },

  normalizeConfig(agent: AgentConfig): AgentConfig {
    return { ...agent, model: agent.model || "default" };
  },

  async listModels(apiKey?: string) {
    try {
      const bundle = await getSharedServer(apiKey);
      const client = bundle.client as {
        config?: {
          get?: () => Promise<unknown>;
          providers?: () => Promise<unknown>;
        };
      };
      let models = collectModels(await client.config?.get?.());
      if (!models.length) models = collectModels(await client.config?.providers?.());
      if (!models.length) {
        return { models: FALLBACK, source: "fallback" as const, error: "No providers configured in OpenCode" };
      }
      return { models, source: "live" as const };
    } catch (err) {
      return { models: FALLBACK, source: "fallback" as const, error: errorMessage(err) };
    }
  },

  async probe() {
    await requireHostCommand(
      "opencode",
      "OpenCode CLI is not on PATH. Install the OpenCode CLI on this host.",
    );
  },

  async create(opts) {
    return OpencodeSession.connect(opts);
  },

  async resume(agentId, opts) {
    return OpencodeSession.connect(opts, agentId);
  },

  async shutdown() {
    await closeSharedServer();
  },
};
