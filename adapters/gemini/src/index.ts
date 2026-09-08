import { randomUUID } from "node:crypto";
import {
  AdapterError,
  errorMessage,
  pendingRun,
  type Adapter,
  type AdapterCreateOptions,
  type AdapterSession,
} from "@glassys/adapter-contract";
import { type AgentConfig, type ModelCatalogItem } from "@glassys/protocol";
import { mapGeminiChunk } from "./mapper.js";

export const GEMINI_STATIC_CATALOG: ModelCatalogItem[] = [
  { id: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro" },
  { id: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash" },
  { id: "gemini-2.0-flash", displayName: "Gemini 2.0 Flash" },
];

type GeminiSessionHandle = {
  initialize?: () => Promise<void>;
  sendStream: (text: string, signal?: AbortSignal) => AsyncIterable<unknown>;
};

type GeminiAgentCtor = new (opts: Record<string, unknown>) => {
  session: (opts?: { sessionId?: string }) => GeminiSessionHandle;
  resumeSession?: (sessionId: string) => GeminiSessionHandle | Promise<GeminiSessionHandle>;
};

async function loadSdk(): Promise<{ GeminiCliAgent: GeminiAgentCtor }> {
  try {
    return (await import("@google/gemini-cli-sdk")) as { GeminiCliAgent: GeminiAgentCtor };
  } catch (err) {
    throw new AdapterError(
      `Gemini CLI SDK is not available: ${errorMessage(err)}. @google/gemini-cli-sdk is not on npm yet; install the Gemini CLI on this host or link the SDK from the gemini-cli repo.`,
      "startup",
    );
  }
}

class GeminiSession implements AdapterSession {
  private tools = new Map<string, string>();
  private model: string;
  private handle: GeminiSessionHandle;
  private opts: AdapterCreateOptions;

  constructor(handle: GeminiSessionHandle, readonly agentId: string, model: string, opts: AdapterCreateOptions) {
    this.handle = handle;
    this.model = model;
    this.opts = opts;
  }

  static async start(opts: AdapterCreateOptions, resumeId?: string): Promise<GeminiSession> {
    const id = resumeId || randomUUID();
    const model = opts.model || "gemini-2.5-pro";
    const handle = await openHandle(opts, resumeId, model, id);
    return new GeminiSession(handle, id, model, opts);
  }

  private async retarget(model: string): Promise<void> {
    if (model === this.model) return;
    this.handle = await openHandle(this.opts, this.agentId, model, this.agentId);
    this.model = model;
  }

  async send(text: string, onEvent: Parameters<AdapterSession["send"]>[1], sendOpts?: { model?: string }) {
    if (sendOpts?.model) await this.retarget(sendOpts.model);
    const runId = randomUUID();
    return pendingRun(runId, async ({ signal, isCancelled }) => {
      try {
        for await (const chunk of this.handle.sendStream(text, signal)) {
          if (isCancelled()) return "cancelled";
          for (const ev of mapGeminiChunk(chunk, this.tools)) onEvent(ev);
        }
        return "finished";
      } catch (err) {
        if (isCancelled()) return "cancelled";
        throw new AdapterError(errorMessage(err), "run");
      }
    });
  }

  async dispose(): Promise<void> {
    /* SDK session is GC'd; no required close */
  }
}

async function openHandle(
  opts: AdapterCreateOptions,
  resumeId: string | undefined,
  model: string,
  sessionId: string,
): Promise<GeminiSessionHandle> {
  const { GeminiCliAgent } = await loadSdk();
  const agent = new GeminiCliAgent({
    cwd: opts.cwd,
    model,
    ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
  });
  const handle = resumeId && agent.resumeSession ? await agent.resumeSession(resumeId) : agent.session({ sessionId });
  await handle.initialize?.();
  return handle;
}

export const geminiAdapter: Adapter = {
  id: "gemini",
  displayName: "Gemini CLI",
  description: "Google Gemini CLI SDK, local against the workspace cwd.",
  capabilities: {
    models: true,
    sandbox: false,
    settingSources: false,
    autoRun: false,
    cancel: true,
    resume: false,
    discover: false,
    toolConfirmation: "none",
    auth: { kind: "api-key", envNames: ["GEMINI_API_KEY", "GOOGLE_API_KEY"] },
    defaultModel: { id: "gemini-2.5-pro", params: [] },
    liveCatalog: false,
  },

  normalizeConfig(agent: AgentConfig): AgentConfig {
    return { ...agent, model: agent.model || "gemini-2.5-pro" };
  },

  async listModels() {
    try {
      await loadSdk();
    } catch {
      /* Static catalog; probe() reports a missing SDK. Do not surface that as a live-catalog failure. */
    }
    return {
      models: GEMINI_STATIC_CATALOG,
      source: "fallback" as const,
    };
  },

  async probe() {
    await loadSdk();
  },

  async create(opts) {
    await loadSdk();
    return GeminiSession.start(opts);
  },

  async resume(agentId, opts) {
    await loadSdk();
    return GeminiSession.start(opts, agentId);
  },
};
