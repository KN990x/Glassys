import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  AdapterError,
  asRecord,
  errorMessage,
  imagePartsFromAttachments,
  pendingRun,
  promptWithAttachments,
  requireHostCommand,
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
import { JsonRpcStdio } from "./rpc.js";
import { registerHostHandlers } from "./host.js";
import { mapAcpUpdate } from "./mapper.js";

const FALLBACK: ModelCatalogItem[] = [{ id: "default", displayName: "Agent default" }];
export const ACP_CANCEL_TIMEOUT_MS = 20_000;

function commandOf(opts: AdapterCreateOptions): { command: string; args: string[] } {
  const command = optionString(opts.options, "command", "");
  const args = optionStringArray(opts.options, "args", []);
  if (!command) throw new AdapterError("ACP adapter needs agent.options.command (or a registry pick)", "startup");
  return { command, args };
}

async function applySessionModel(rpc: JsonRpcStdio, sessionId: string, model: string): Promise<void> {
  if (!model || model === "default") return;
  try {
    await rpc.request("session/set_model", { sessionId, modelId: model });
    return;
  } catch {
    /* ACP v1 uses config options for some agents */
  }
  try {
    await rpc.request("session/set_config_option", { sessionId, id: "model", value: model });
  } catch {
    /* agent may not support model selection */
  }
}

async function authenticateIfNeeded(
  rpc: JsonRpcStdio,
  init: Record<string, unknown> | undefined,
  apiKey?: string,
): Promise<void> {
  const methods = Array.isArray(init?.authMethods) ? init.authMethods : [];
  if (!methods.length) return;
  const first = asRecord(methods[0]);
  const methodId = typeof first?.id === "string" ? first.id : "";
  if (!methodId) return;
  try {
    await rpc.request("authenticate", {
      methodId,
      ...(apiKey ? { params: { apiKey } } : {}),
    });
  } catch (err) {
    throw new AdapterError(`ACP authenticate failed: ${errorMessage(err)}`, "startup");
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

async function openAcpSession(
  rpc: JsonRpcStdio,
  opts: AdapterCreateOptions,
  resumeId: string | undefined,
  caps: Record<string, unknown> | undefined,
): Promise<string> {
  const sessionCaps = asRecord(caps?.session) ?? caps;
  const loadSession = acpShouldLoadSession(caps);
  const canResume = sessionCaps?.resume === true || sessionCaps?.sessionResume === true;
  if (resumeId) {
    if (canResume) {
      try {
        await rpc.request("session/resume", { sessionId: resumeId, cwd: opts.cwd, mcpServers: [] });
        return resumeId;
      } catch {
        /* fall through to load */
      }
    }
    if (loadSession) {
      await rpc.request("session/load", { sessionId: resumeId, cwd: opts.cwd, mcpServers: [] });
      return resumeId;
    }
    throw new AdapterError("ACP agent cannot resume the stored session", "startup");
  }
  const created = asRecord(await rpc.request("session/new", { cwd: opts.cwd, mcpServers: [] }));
  return typeof created?.sessionId === "string" ? created.sessionId : randomUUID();
}

class AcpSession implements AdapterSession {
  private tools = new Map<string, string>();
  private sessionId: string;

  constructor(
    private rpc: JsonRpcStdio,
    sessionId: string,
    readonly agentId: string,
    private cleanupHost: () => void,
  ) {
    this.sessionId = sessionId;
  }

  static async start(opts: AdapterCreateOptions, resumeId?: string): Promise<AcpSession> {
    const { command, args } = commandOf(opts);
    const rpc = new JsonRpcStdio(command, args, opts.cwd, opts.apiKey ? { API_KEY: opts.apiKey } : undefined);
    const cleanupHost = registerHostHandlers(rpc, opts.cwd, opts.options);
    let init: Record<string, unknown> | undefined;
    try {
      init = asRecord(
        await rpc.request("initialize", {
          protocolVersion: 1,
          clientInfo: { name: "Glassys", version: "0.1.0" },
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
            terminal: true,
          },
        }),
      ) ?? undefined;
      await authenticateIfNeeded(rpc, init, opts.apiKey);
    } catch (err) {
      cleanupHost();
      await rpc.close();
      throw err instanceof AdapterError ? err : new AdapterError(`ACP initialize failed: ${errorMessage(err)}`, "startup");
    }
    const caps = asRecord(init?.agentCapabilities) ?? asRecord(init?.capabilities) ?? undefined;
    await persistResumeCapability(opts.storeDir, command, args, acpChildSupportsResume(caps));
    let sessionId: string;
    try {
      sessionId = await openAcpSession(rpc, opts, resumeId, caps);
    } catch (err) {
      cleanupHost();
      await rpc.close();
      throw new AdapterError(`ACP session setup failed: ${errorMessage(err)}`, "startup");
    }
    await applySessionModel(rpc, sessionId, opts.model);
    return new AcpSession(rpc, sessionId, sessionId, cleanupHost);
  }

  async send(
    text: string,
    onEvent: Parameters<AdapterSession["send"]>[1],
    sendOpts?: { model?: string; attachments?: PromptAttachment[] },
  ) {
    if (sendOpts?.model && sendOpts.model !== "default") {
      await applySessionModel(this.rpc, this.sessionId, sendOpts.model);
    }
    const runId = randomUUID();
    const promptText = promptWithAttachments(text, sendOpts?.attachments);
    const images = imagePartsFromAttachments(sendOpts?.attachments);
    const promptBlocks: Array<Record<string, unknown>> = [{ type: "text", text: promptText }];
    for (const img of images) {
      promptBlocks.push({ type: "image", mimeType: img.mime, data: img.data });
    }
    return pendingRun(runId, async ({ isCancelled }) => {
      const onUpdate = (params: unknown) => {
        for (const ev of mapAcpUpdate(params, this.tools)) onEvent(ev);
      };
      const off = this.rpc.onNotification("session/update", onUpdate);
      const prompt = this.rpc.request("session/prompt", {
        sessionId: this.sessionId,
        prompt: promptBlocks,
      });
      let stop = false;
      let cancelledAt = 0;
      const watch = (async () => {
        while (!isCancelled() && !stop) await new Promise((r) => setTimeout(r, 40));
        if (!isCancelled()) return;
        cancelledAt = Date.now();
        try {
          this.rpc.notify("session/cancel", { sessionId: this.sessionId });
        } catch {
          /* ignore */
        }
      })();
      try {
        const result = await Promise.race([
          prompt,
          (async () => {
            for (;;) {
              await new Promise((r) => setTimeout(r, 40));
              if (stop) return prompt;
              if (cancelledAt && Date.now() - cancelledAt > ACP_CANCEL_TIMEOUT_MS) {
                throw new AdapterError("ACP did not stop after session/cancel", "run");
              }
            }
          })(),
        ]);
        if (isCancelled()) return "cancelled";
        const rec = asRecord(result);
        const usage = asRecord(rec?.usage);
        if (usage) {
          const inputTokens =
            typeof usage.inputTokens === "number"
              ? usage.inputTokens
              : typeof usage.input_tokens === "number"
                ? usage.input_tokens
                : undefined;
          const outputTokens =
            typeof usage.outputTokens === "number"
              ? usage.outputTokens
              : typeof usage.output_tokens === "number"
                ? usage.output_tokens
                : undefined;
          if (inputTokens != null || outputTokens != null) {
            onEvent({ type: "run.usage", inputTokens, outputTokens });
          }
        }
        if (rec?.stopReason === "cancelled") return "cancelled";
        if (rec?.stopReason === "max_tokens" || rec?.stopReason === "error") return "error";
        return "finished";
      } catch (err) {
        if (isCancelled()) return "cancelled";
        throw new AdapterError(errorMessage(err), "run");
      } finally {
        stop = true;
        off();
        void watch;
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
    toolConfirmation: "auto-review-deny",
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

  async listModels() {
    return {
      models: FALLBACK,
      source: "fallback" as const,
    };
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
