import { randomUUID } from "node:crypto";
import { createOpencode } from "@opencode-ai/sdk";
import {
  AdapterError,
  asRecord,
  errorMessage,
  fixtureRecorder,
  pendingRun,
  promptWithAttachments,
  requireRunnableCommand,
  str,
  type Adapter,
  type AdapterCreateOptions,
  type AdapterSession,
  type PromptAttachment,
} from "@glassys/adapter-contract";
import { type AgentConfig, type ModelCatalogItem } from "@glassys/protocol";
import {
  isOpencodeError,
  isOpencodeIdle,
  isStaleOpencodeIdle,
  mapOpencodeEvent,
  opencodeErrorMessage,
  opencodeMapState,
  opencodePermission,
  opencodeSessionId,
} from "./mapper.js";
import { EventPump } from "./pump.js";

/** Raw SDK events to a JSONL file when GLASSYS_RECORD_FIXTURES is set (see fixtureRecorder). */
const recordRaw = fixtureRecorder("opencode");

export { EventPump } from "./pump.js";

const OPENCODE_IDLE_MS = 600_000;
const OPENCODE_DRAIN_MS = 2_000;

const FALLBACK: ModelCatalogItem[] = [{ id: "default", displayName: "Default (OpenCode config)" }];

type OcBundle = Awaited<ReturnType<typeof createOpencode>>;
type OcClient = OcBundle["client"];

let envLock = Promise.resolve();
let sharedServer: Promise<OcBundle> | null = null;
let sharedKey = "";
/** Set when a session's event stream ended on its own: the `opencode serve` child is likely gone. */
let serverSuspect = false;
/** Runs in flight on the shared server; a key change must not pull it out from under them. */
let activeRuns = 0;

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
  /* A new key applies once nothing is running on the old server. */
  const keyChanged = sharedServer !== null && sharedKey !== key && activeRuns === 0;
  if (sharedServer && (keyChanged || (serverSuspect && activeRuns === 0))) await closeSharedServer();
  serverSuspect = false;
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

/**
 * The SDK client returns `{ error }` instead of throwing (heyapi's `throwOnError` is off), so a
 * failed call looks like success unless every result is checked.
 */
export async function checked<T = unknown>(call: Promise<T>): Promise<T> {
  const result = await call;
  const rec = asRecord(result);
  if (rec && rec.error !== undefined && rec.error !== null) {
    throw new Error(opencodeErrorMessage(rec.error) || JSON.stringify(rec.error));
  }
  return result;
}

function sessionIdFrom(created: unknown): string | undefined {
  const rec = asRecord(created);
  if (!rec) return undefined;
  return str(rec.id) || str(asRecord(rec.data)?.id) || str(asRecord(rec.session)?.id);
}

/** OpenCode needs both halves; "default" leaves the choice to the operator's OpenCode config. */
export function parseModel(model: string): { providerID: string; modelID: string } | undefined {
  if (!model || model === "default") return undefined;
  const slash = model.indexOf("/");
  if (slash > 0 && slash < model.length - 1) {
    return { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) };
  }
  throw new AdapterError(
    `OpenCode models are provider/model (for example anthropic/claude-sonnet-4); got "${model}"`,
    "startup",
  );
}

/**
 * OpenCode picks the project (sessions, config, event bus) from the `directory` query of every
 * request and falls back to the server process's cwd, which is the Glassys clone. Every call
 * about a session therefore names the workspace.
 */
async function eventStream(client: OcClient, directory: string): Promise<AsyncIterable<unknown>> {
  const sub = await client.event.subscribe({ query: { directory } } as never);
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
  /* Only an explicit provider map: any other object (a whole config) is not a model list. */
  const mapRec = asRecord(rec?.provider) ?? asRecord(rec?.providers) ?? {};
  for (const [providerId, val] of Object.entries(mapRec)) {
    addProviderModels(models, providerId, asRecord(val)?.models);
  }
  return models;
}

function foreignSession(event: unknown, sessionId: string): boolean {
  const sid = opencodeSessionId(event);
  return Boolean(sid && sid !== sessionId);
}

class OpencodeSession implements AdapterSession {

  constructor(
    readonly agentId: string,
    private client: OcClient,
    private model: string,
    private pump: EventPump,
    private directory: string,
  ) {}

  static async connect(opts: AdapterCreateOptions, sessionId?: string): Promise<OpencodeSession> {
    let bundle: OcBundle;
    try {
      bundle = await getSharedServer(opts.apiKey);
    } catch (err) {
      throw new AdapterError(
        `OpenCode server failed to start: ${errorMessage(err)}. Check that \`opencode serve\` runs on this host.`,
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
            await checked(
              get({
                path: { id },
                query: { directory: opts.cwd },
              }),
            );
          } catch (err) {
            throw new AdapterError(`OpenCode session could not be resumed: ${errorMessage(err)}`, "startup");
          }
        }
      }
      if (!id) {
        const created = await checked(
          bundle.client.session.create({
            body: { title: "Glassys" },
            query: { directory: opts.cwd },
          } as never),
        );
        id = sessionIdFrom(created);
      }
      if (!id) throw new AdapterError("OpenCode did not return a session id", "startup");
      const pump = new EventPump(await eventStream(bundle.client, opts.cwd), () => {
        serverSuspect = true;
      });
      return new OpencodeSession(id, bundle.client, opts.model, pump, opts.cwd);
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
      activeRuns += 1;
      const state = opencodeMapState();
      const prompt = checked(
        this.client.session.prompt({
          path: { id: this.agentId },
          query: { directory: this.directory },
          body: {
            parts: [{ type: "text", text: promptText }],
            ...(model ? { model } : {}),
          },
        } as never),
      );
      let promptSettled = false;
      let promptError: unknown;
      let idle = false;
      let failed = false;
      let sawRunEvent = false;
      let drainArmed = false;
      /* The prompt call returns when the turn is over; stop waiting out the long idle timeout. */
      const settle = () => {
        promptSettled = true;
        this.pump.wake();
      };
      prompt.then(settle, (err) => {
        promptError = err;
        settle();
      });
      const handle = async (event: unknown) => {
        recordRaw?.(event);
        if (foreignSession(event, this.agentId)) return;
        const permission = opencodePermission(event);
        if (permission) {
          /* Glassys has no one to ask: refuse, as Cursor's Auto-review and Claude's dontAsk do. */
          await this.reject(permission.id);
          return;
        }
        const mapped = mapOpencodeEvent(event, state, this.agentId);
        if (mapped.length) sawRunEvent = true;
        for (const ev of mapped) {
          onEvent(ev);
          if (ev.type === "run.error") failed = true;
        }
        if (isOpencodeError(event)) failed = true;
      };
      try {
        while (!isCancelled()) {
          const waitMs = promptSettled ? OPENCODE_DRAIN_MS : OPENCODE_IDLE_MS;
          const next = await this.pump.next(waitMs, signal);
          if (isCancelled()) break;
          if (next.event) {
            await handle(next.event);
            if (isOpencodeIdle(next.event) && !foreignSession(next.event, this.agentId)) {
              if (isStaleOpencodeIdle(next.event, sawRunEvent, promptSettled)) continue;
              idle = true;
              break;
            }
            if (failed) break;
            continue;
          }
          if (next.done) break;
          if (promptSettled) {
            /* One short window for events that trail the prompt's response, then done. */
            if (drainArmed) break;
            drainArmed = true;
            continue;
          }
          throw new AdapterError("OpenCode timed out waiting for run events", "run");
        }
        for (const leftover of this.pump.drain()) {
          if (isCancelled()) break;
          await handle(leftover);
        }
        if (isCancelled()) {
          try {
            await checked(this.client.session.abort({ path: { id: this.agentId }, query: { directory: this.directory } } as never));
          } catch {
            /* ignore */
          }
          await Promise.race([prompt.catch(() => undefined), new Promise((r) => setTimeout(r, OPENCODE_DRAIN_MS))]);
          return "cancelled";
        }
        await prompt.catch(() => undefined);
        if (promptError !== undefined && !failed) {
          /* A rejected prompt (bad model, auth) produces no events; say why instead of "finished". */
          if (idle && sawRunEvent) return "finished";
          throw new AdapterError(errorMessage(promptError), "run");
        }
        return failed ? "error" : "finished";
      } catch (err) {
        if (isCancelled()) return "cancelled";
        throw err;
      } finally {
        activeRuns -= 1;
      }
    });
  }

  private async reject(permissionId: string): Promise<void> {
    const reply = (this.client as unknown as {
      postSessionIdPermissionsPermissionId?: (args: unknown) => Promise<unknown>;
    }).postSessionIdPermissionsPermissionId;
    if (!reply) return;
    try {
      await checked(
        reply.call(this.client, {
          path: { id: this.agentId, permissionID: permissionId },
          query: { directory: this.directory },
          body: { response: "reject" },
        }),
      );
    } catch {
      /* the tool part still ends with its own error */
    }
  }

  /** A dropped event stream would leave every later run blind; the runtime reopens the session. */
  get closed(): boolean {
    return this.pump.finished;
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

  async listModels(apiKey?: string, cwd?: string) {
    try {
      const bundle = await getSharedServer(apiKey);
      const client = bundle.client as {
        config?: {
          get?: (args?: unknown) => Promise<unknown>;
          providers?: (args?: unknown) => Promise<unknown>;
        };
      };
      /* The workspace's own opencode.json can add providers; ask in its directory. */
      const args = cwd ? { query: { directory: cwd } } : undefined;
      /* The authenticated providers, not the raw config: a config without `provider` is not a model list. */
      const models = collectModels(await checked(client.config?.providers?.(args) ?? Promise.resolve(undefined)));
      if (!models.length) {
        return { models: FALLBACK, source: "fallback" as const, error: "No providers configured in OpenCode" };
      }
      return { models, source: "live" as const };
    } catch (err) {
      return { models: FALLBACK, source: "fallback" as const, error: errorMessage(err) };
    }
  },

  async probe() {
    await requireRunnableCommand("opencode", ["--version"], "OpenCode");
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
