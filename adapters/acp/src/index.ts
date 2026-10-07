import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import {
  AdapterError,
  asRecord,
  errorMessage,
  fixtureRecorder,
  imagePartsFromAttachments,
  pendingRun,
  promptWithAttachments,
  requireHostCommand,
  str,
  usageFrom,
  type Adapter,
  type AdapterCreateOptions,
  type AdapterSession,
  type PromptAttachment,
} from "@glassys/adapter-contract";
import {
  optionBool,
  optionString,
  optionStringArray,
  type AdapterDiscoverItem,
  type AgentConfig,
  type ModelCatalogItem,
} from "@glassys/protocol";
import { JsonRpcStdio, RpcError } from "./rpc.js";
import { type HostLedger, hostLedger, registerHostHandlers } from "./host.js";
import { acpMapState, mapAcpUpdate } from "./mapper.js";

/** Raw SDK events to a JSONL file when GLASSYS_RECORD_FIXTURES is set (see fixtureRecorder). */
const recordRaw = fixtureRecorder("acp");

const GLASSYS_VERSION = (createRequire(import.meta.url)("../package.json") as { version: string }).version;

const FALLBACK: ModelCatalogItem[] = [{ id: "default", displayName: "Agent default" }];
export const ACP_CANCEL_TIMEOUT_MS = 20_000;
/** `npx -y` may download the agent on first start, so setup gets minutes, not seconds. */
export const ACP_SETUP_TIMEOUT_MS = 180_000;

function commandOf(opts: AdapterCreateOptions): { command: string; args: string[] } {
  const command = optionString(opts.options, "command", "");
  const args = optionStringArray(opts.options, "args", []);
  if (!command) throw new AdapterError("ACP adapter needs agent.options.command (or a registry pick)", "startup");
  return { command, args };
}

/** How long a setup-side request (model switch, authenticate) may take before the run gives up on it. */
export const ACP_CONTROL_TIMEOUT_MS = 30_000;

/** Ask the agent to use `model`. Agents without model selection keep their own default. */
async function applySessionModel(rpc: JsonRpcStdio, sessionId: string, model: string): Promise<void> {
  if (!model || model === "default") return;
  try {
    await rpc.request("session/set_model", { sessionId, modelId: model }, ACP_CONTROL_TIMEOUT_MS);
    return;
  } catch {
    /* ACP v1 uses config options for some agents */
  }
  try {
    await rpc.request("session/set_config_option", { sessionId, configId: "model", value: model }, ACP_CONTROL_TIMEOUT_MS);
  } catch {
    /* agent may not support model selection */
  }
}

/** ACP's `auth_required` error: the agent wants `authenticate` before it opens a session. */
export function isAcpAuthRequired(err: unknown): boolean {
  if (!(err instanceof RpcError)) return false;
  return err.code === -32000 || /auth/i.test(err.message);
}

/**
 * Authenticate only when the agent asked for it. An agent that is already signed in must not be
 * pushed through a login flow, which on a headless host may never finish.
 */
async function withAuthRetry<T>(
  rpc: JsonRpcStdio,
  init: Record<string, unknown> | undefined,
  open: () => Promise<T>,
): Promise<T> {
  try {
    return await open();
  } catch (err) {
    const methods = Array.isArray(init?.authMethods) ? init.authMethods : [];
    const first = asRecord(methods[0]);
    const methodId = typeof first?.id === "string" ? first.id : "";
    if (!isAcpAuthRequired(err) || !methodId) throw err;
    try {
      await rpc.request("authenticate", { methodId }, ACP_CONTROL_TIMEOUT_MS);
    } catch (authErr) {
      throw new AdapterError(`ACP authenticate failed: ${errorMessage(authErr)}`, "startup");
    }
    return open();
  }
}

export function acpResumeUnsupported(resumeId: string | undefined, caps: Record<string, unknown> | undefined): boolean {
  if (!resumeId) return false;
  const sessionCaps = asRecord(caps?.session) ?? caps;
  const loadSession = acpShouldLoadSession(caps);
  const canResume = sessionCaps?.resume === true || sessionCaps?.sessionResume === true;
  return !canResume && !loadSession;
}

export function acpShouldLoadSession(caps: Record<string, unknown> | undefined): boolean {
  const sessionCaps = asRecord(caps?.session) ?? caps;
  return sessionCaps?.loadSession === true;
}

export function acpChildSupportsResume(caps: Record<string, unknown> | undefined): boolean {
  return !acpResumeUnsupported("session", caps);
}

function resumeCapPath(storeDir: string): string {
  return join(storeDir, "resume-capability.json");
}

async function persistResumeCapability(
  storeDir: string,
  command: string,
  args: string[],
  supported: boolean,
): Promise<void> {
  if (!storeDir) return;
  try {
    await mkdir(storeDir, { recursive: true });
    await writeFile(resumeCapPath(storeDir), JSON.stringify({ command, args, supported }), "utf8");
  } catch {
    /* store is best-effort */
  }
}

async function storedResumeCapability(
  storeDir: string,
  command: string,
  args: string[],
): Promise<boolean> {
  try {
    const raw = JSON.parse(await readFile(resumeCapPath(storeDir), "utf8")) as {
      command?: string;
      args?: unknown;
      supported?: boolean;
    };
    if (raw.command !== command) return false;
    if (JSON.stringify(raw.args ?? []) !== JSON.stringify(args)) return false;
    return raw.supported === true;
  } catch {
    return false;
  }
}

/**
 * The models an agent offers, from a session/new, load or resume result: the session-model
 * shape (`models.availableModels`) or a config option of category "model". Undefined when the
 * agent offers no choice.
 */
export function acpModelsFrom(result: unknown): ModelCatalogItem[] | undefined {
  const rec = asRecord(result);
  const models = asRecord(rec?.models);
  if (models && Array.isArray(models.availableModels)) {
    return models.availableModels.flatMap((m) => {
      const item = asRecord(m);
      const id = str(item?.modelId);
      return id ? [{ id, displayName: str(item?.name) || id, description: str(item?.description) }] : [];
    });
  }
  const options = Array.isArray(rec?.configOptions) ? rec.configOptions.map((o) => asRecord(o)) : [];
  const select = options.find((o) => (o?.category === "model" || o?.id === "model") && Array.isArray(o?.options));
  if (!select) return undefined;
  const flat = (select.options as unknown[]).flatMap((o) => {
    const group = asRecord(o);
    return Array.isArray(group?.options) ? group.options : [o];
  });
  return flat.flatMap((o) => {
    const item = asRecord(o);
    const id = str(item?.value);
    return id ? [{ id, displayName: str(item?.name) || id, description: str(item?.description) }] : [];
  });
}

function modelCatalogPath(storeDir: string): string {
  return join(storeDir, "models.json");
}

/** What the agent offered when it last opened a session; an empty list means it offers no choice. */
async function persistModelCatalog(storeDir: string, command: string, args: string[], models: ModelCatalogItem[]): Promise<void> {
  if (!storeDir) return;
  try {
    await mkdir(storeDir, { recursive: true });
    await writeFile(modelCatalogPath(storeDir), JSON.stringify({ command, args, models }), "utf8");
  } catch {
    /* store is best-effort */
  }
}

async function storedModelCatalog(storeDir: string, command: string, args: string[]): Promise<ModelCatalogItem[] | undefined> {
  try {
    const raw = JSON.parse(await readFile(modelCatalogPath(storeDir), "utf8")) as { command?: string; args?: unknown; models?: unknown };
    if (raw.command !== command || JSON.stringify(raw.args ?? []) !== JSON.stringify(args)) return undefined;
    return Array.isArray(raw.models) ? (raw.models as ModelCatalogItem[]) : undefined;
  } catch {
    return undefined;
  }
}

async function openAcpSession(
  rpc: JsonRpcStdio,
  opts: AdapterCreateOptions,
  resumeId: string | undefined,
  caps: Record<string, unknown> | undefined,
): Promise<{ sessionId: string; models?: ModelCatalogItem[] }> {
  const sessionCaps = asRecord(caps?.session) ?? caps;
  const loadSession = acpShouldLoadSession(caps);
  const canResume = sessionCaps?.resume === true || sessionCaps?.sessionResume === true;
  if (resumeId) {
    if (canResume) {
      try {
        const resumed = await rpc.request("session/resume", { sessionId: resumeId, cwd: opts.cwd, mcpServers: [] }, ACP_SETUP_TIMEOUT_MS);
        return { sessionId: resumeId, models: acpModelsFrom(resumed) };
      } catch {
        /* fall through to load */
      }
    }
    if (loadSession) {
      const loaded = await rpc.request("session/load", { sessionId: resumeId, cwd: opts.cwd, mcpServers: [] }, ACP_SETUP_TIMEOUT_MS);
      return { sessionId: resumeId, models: acpModelsFrom(loaded) };
    }
    throw new AdapterError("ACP agent cannot resume the stored session", "startup");
  }
  const created = asRecord(
    await rpc.request("session/new", { cwd: opts.cwd, mcpServers: [] }, ACP_SETUP_TIMEOUT_MS),
  );
  if (typeof created?.sessionId !== "string" || !created.sessionId) {
    throw new AdapterError("ACP session/new returned no sessionId", "startup");
  }
  return { sessionId: created.sessionId, models: acpModelsFrom(created) ?? [] };
}

/** Opening a session only to read the catalog must not hold the model picker for minutes. */
export const ACP_MODEL_PROBE_TIMEOUT_MS = 45_000;
/** An agent that would not open a session is not started again for every model list. */
export const ACP_MODEL_PROBE_RETRY_MS = 5 * 60_000;
const probes = new Map<string, Promise<void>>();
const probeFailures = new Map<string, { at: number; error: unknown }>();

/** Open and close a session so the agent announces its models; concurrent asks share one. */
function probeCatalog(opts: AdapterCreateOptions): Promise<void> {
  const key = JSON.stringify([optionString(opts.options, "command", ""), optionStringArray(opts.options, "args", []), opts.storeDir]);
  const failed = probeFailures.get(key);
  if (failed && Date.now() - failed.at < ACP_MODEL_PROBE_RETRY_MS) return Promise.reject(failed.error);
  const running = probes.get(key);
  if (running) return running;
  const probe = (async () => {
    const starting = AcpSession.start(opts);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AdapterError("The ACP agent did not open a session in time", "startup")), ACP_MODEL_PROBE_TIMEOUT_MS);
    });
    try {
      const session = await Promise.race([starting, late]);
      await session.dispose();
    } catch (err) {
      void starting.then((session) => session.dispose(), () => undefined);
      probeFailures.set(key, { at: Date.now(), error: err });
      throw err;
    } finally {
      clearTimeout(timer);
    }
  })().finally(() => probes.delete(key));
  probes.set(key, probe);
  return probe;
}

/** What ends a prompt turn other than finishing it, in the operator's words. */
const STOP_REASON_ERRORS: Record<string, string> = {
  max_tokens: "The agent hit its token limit",
  max_turn_requests: "The agent hit its turn limit",
  refusal: "The agent refused to continue",
};

class AcpSession implements AdapterSession {
  private sessionId: string;
  private model: string;

  constructor(
    private rpc: JsonRpcStdio,
    sessionId: string,
    readonly agentId: string,
    private cleanupHost: () => void,
    model: string,
    /** The agent said it takes image content blocks (promptCapabilities.image). */
    private takesImages: boolean,
    private ledger: HostLedger,
  ) {
    this.sessionId = sessionId;
    this.model = model;
  }

  get closed(): boolean {
    return !this.rpc.alive;
  }

  static async start(opts: AdapterCreateOptions, resumeId?: string): Promise<AcpSession> {
    const { command, args } = commandOf(opts);
    const rpc = new JsonRpcStdio(command, args, opts.cwd, opts.apiKey ? { API_KEY: opts.apiKey } : undefined);
    const ledger = hostLedger();
    const cleanupHost = registerHostHandlers(rpc, opts.cwd, opts.options, opts.protectedPaths, ledger);
    let init: Record<string, unknown> | undefined;
    try {
      init = asRecord(
        await rpc.request(
          "initialize",
          {
            protocolVersion: 1,
            clientInfo: { name: "Glassys", version: GLASSYS_VERSION },
            clientCapabilities: {
              fs: { readTextFile: true, writeTextFile: true },
              terminal: true,
            },
          },
          ACP_SETUP_TIMEOUT_MS,
        ),
      ) ?? undefined;
    } catch (err) {
      cleanupHost();
      await rpc.close();
      throw err instanceof AdapterError ? err : new AdapterError(`ACP initialize failed: ${errorMessage(err)}`, "startup");
    }
    const caps = asRecord(init?.agentCapabilities) ?? asRecord(init?.capabilities) ?? undefined;
    await persistResumeCapability(opts.storeDir, command, args, acpChildSupportsResume(caps));
    let sessionId: string;
    try {
      const opened = await withAuthRetry(rpc, init, () => openAcpSession(rpc, opts, resumeId, caps));
      sessionId = opened.sessionId;
      if (opened.models) await persistModelCatalog(opts.storeDir, command, args, opened.models);
    } catch (err) {
      cleanupHost();
      await rpc.close();
      throw err instanceof AdapterError && /authenticate/.test(err.message)
        ? err
        : new AdapterError(`ACP session setup failed: ${errorMessage(err)}`, "startup");
    }
    await applySessionModel(rpc, sessionId, opts.model);
    const promptCaps = asRecord(caps?.promptCapabilities);
    return new AcpSession(rpc, sessionId, sessionId, cleanupHost, opts.model, promptCaps?.image === true, ledger);
  }

  async send(
    text: string,
    onEvent: Parameters<AdapterSession["send"]>[1],
    sendOpts?: { model?: string; attachments?: PromptAttachment[] },
  ) {
    /* The gateway passes the model on every send; only a change costs a round trip. */
    if (sendOpts?.model && sendOpts.model !== "default" && sendOpts.model !== this.model) {
      await applySessionModel(this.rpc, this.sessionId, sendOpts.model);
      this.model = sendOpts.model;
    }
    const runId = randomUUID();
    const promptText = promptWithAttachments(text, sendOpts?.attachments);
    /* An agent that did not declare image support gets the files' paths in the text only. */
    const images = this.takesImages ? imagePartsFromAttachments(sendOpts?.attachments) : [];
    const promptBlocks: Array<Record<string, unknown>> = [{ type: "text", text: promptText }];
    for (const img of images) {
      promptBlocks.push({ type: "image", mimeType: img.mime, data: img.data });
    }
    return pendingRun(runId, async ({ signal, isCancelled }) => {
      /* Tool ids are per turn; a long session must not keep every call it ever made. */
      const state = acpMapState(this.ledger);
      const onUpdate = (params: unknown) => {
        recordRaw?.(params);
        for (const ev of mapAcpUpdate(params, state)) onEvent(ev);
      };
      const off = this.rpc.onNotification("session/update", onUpdate);
      const prompt = this.rpc.request("session/prompt", {
        sessionId: this.sessionId,
        prompt: promptBlocks,
      });
      let giveUp: ReturnType<typeof setTimeout> | undefined;
      /* After session/cancel the agent still answers the prompt with stopReason "cancelled". If it
         never does, the prompt is still open in the child and a new one would interleave. */
      const stuck = new Promise<never>((_, reject) => {
        const onAbort = () => {
          try {
            this.rpc.notify("session/cancel", { sessionId: this.sessionId });
          } catch {
            /* ignore */
          }
          giveUp = setTimeout(() => {
            this.cleanupHost();
            void this.rpc.close();
            reject(new AdapterError("ACP did not stop after session/cancel", "run"));
          }, ACP_CANCEL_TIMEOUT_MS);
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      });
      stuck.catch(() => undefined);
      try {
        const rec = asRecord(await Promise.race([prompt, stuck]));
        if (isCancelled() || rec?.stopReason === "cancelled") return "cancelled";
        const usage = usageFrom(rec?.usage);
        if (usage) onEvent({ type: "run.usage", ...usage });
        const stopError = typeof rec?.stopReason === "string" ? STOP_REASON_ERRORS[rec.stopReason] : undefined;
        if (stopError) {
          onEvent({ type: "run.error", message: stopError, phase: "run" });
          return "error";
        }
        return "finished";
      } catch (err) {
        if (isCancelled()) return "cancelled";
        throw err instanceof AdapterError ? err : new AdapterError(errorMessage(err), "run");
      } finally {
        if (giveUp) clearTimeout(giveUp);
        off();
      }
    });
  }

  async dispose(): Promise<void> {
    this.cleanupHost();
    await this.rpc.close();
  }
}

export const acpAdapter: Adapter = {
  id: "acp",
  displayName: "ACP (any agent)",
  description: "Generic Agent Client Protocol host. File and terminal writes apply when auto-run is on. Pick a registry agent or a command.",
  capabilities: {
    models: true,
    sandbox: false,
    settingSources: false,
    autoRun: true,
    cancel: true,
    resume: false,
    discover: true,
    toolConfirmation: "deny-writes",
    attachments: true,
    auth: { kind: "cli-binary", envNames: [] },
    defaultModel: { id: "default", params: [] },
    liveCatalog: false,
  },

  normalizeConfig(agent: AgentConfig): AgentConfig {
    return {
      ...agent,
      model: agent.model || "default",
      options: {
        autoRun: optionBool(agent.options, "autoRun", true),
        command: optionString(agent.options, "command", ""),
        args: optionStringArray(agent.options, "args", []),
        registryId: optionString(agent.options, "registryId", ""),
        ...agent.options,
      },
    };
  },

  /**
   * What the configured agent offers: the catalog its last session announced or, before any
   * session, one opened just to read it. "Agent default" always leads, so the agent can keep
   * choosing for itself.
   */
  async listModels(apiKey, cwd, ctx) {
    const command = optionString(ctx?.options, "command", "");
    if (!ctx || !command) return { models: FALLBACK, source: "fallback" as const };
    const args = optionStringArray(ctx.options, "args", []);
    let offered = await storedModelCatalog(ctx.storeDir, command, args);
    if (!offered) {
      try {
        await probeCatalog({
          cwd: cwd || tmpdir(),
          model: "default",
          modelParams: [],
          storeDir: ctx.storeDir,
          options: ctx.options,
          apiKey,
        });
      } catch (err) {
        return { models: FALLBACK, source: "fallback" as const, error: errorMessage(err) };
      }
      offered = await storedModelCatalog(ctx.storeDir, command, args);
    }
    if (!offered?.length) return { models: FALLBACK, source: "fallback" as const };
    return { models: [...FALLBACK, ...offered.filter((m) => m.id !== "default")], source: "live" as const };
  },

  async discover(): Promise<AdapterDiscoverItem[]> {
    try {
      const res = await fetch("https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json", {
        signal: AbortSignal.timeout(8_000),
      });
      const body = (await res.json()) as { agents?: Array<Record<string, unknown>> };
      const agents = Array.isArray(body.agents) ? body.agents : [];
      return agents.flatMap((a) => {
        const id = typeof a.id === "string" ? a.id : "";
        if (!id || id === "cursor") return [];
        const name = typeof a.name === "string" ? a.name : id;
        const description = typeof a.description === "string" ? a.description : undefined;
        const dist = asRecord(a.distribution);
        const npx = asRecord(dist?.npx);
        const pkg = typeof npx?.package === "string" ? npx.package : "";
        const npxArgs = Array.isArray(npx?.args) ? npx.args.map(String) : [];
        if (pkg) {
          return [{ id, displayName: name, description, command: "npx", args: ["-y", pkg, ...npxArgs] }];
        }
        return [{ id, displayName: name, description }];
      });
    } catch (err) {
      throw new AdapterError(`ACP registry unavailable: ${errorMessage(err)}`, "startup");
    }
  },

  async probe(options?: Record<string, unknown>) {
    const command = optionString(options, "command", "").trim();
    if (!command) {
      if (options) throw new AdapterError("ACP adapter needs agent.options.command (or a registry pick)", "startup");
      return;
    }
    await requireHostCommand(command, `ACP command is not on PATH: ${command}`);
  },

  async shouldResume(_agentId, opts) {
    const command = optionString(opts.options, "command", "");
    const args = optionStringArray(opts.options, "args", []);
    return storedResumeCapability(opts.storeDir, command, args);
  },

  async create(opts) {
    return AcpSession.start(opts);
  },

  async resume(agentId, opts) {
    return AcpSession.start(opts, agentId);
  },
};
