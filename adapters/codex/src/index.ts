import { randomUUID } from "node:crypto";
import { Codex } from "@openai/codex-sdk";
import {
  AdapterError,
  errorMessage,
  pendingRun,
  type Adapter,
  type AdapterCreateOptions,
  type AdapterSession,
} from "@glassys/adapter-contract";
import { type AgentConfig, type ModelCatalogItem } from "@glassys/protocol";
import { isCodexTurnDone, mapCodexJsonl, threadIdFromEvent } from "./mapper.js";

export const CODEX_STATIC_CATALOG: ModelCatalogItem[] = [
  { id: "gpt-5-codex", displayName: "GPT-5 Codex" },
  { id: "gpt-5", displayName: "GPT-5" },
  { id: "o3", displayName: "o3" },
];

function threadOpts(opts: AdapterCreateOptions) {
  return {
    workingDirectory: opts.cwd,
    skipGitRepoCheck: true,
    ...(opts.model ? { model: opts.model } : {}),
  };
}

class CodexSession implements AdapterSession {
  private tools = new Map<string, string>();
  private snapshots = new Map<string, string>();
  agentId: string;

  constructor(
    private thread: ReturnType<Codex["startThread"]>,
    agentId: string,
  ) {
    this.agentId = agentId;
  }

  static start(opts: AdapterCreateOptions, resumeId?: string): CodexSession {
    const client = new Codex(opts.apiKey ? { apiKey: opts.apiKey } : {});
    const thread =
      resumeId && resumeId !== "pending"
        ? client.resumeThread(resumeId, threadOpts(opts))
        : client.startThread(threadOpts(opts));
    const initialId = resumeId && resumeId !== "pending" ? resumeId : thread.id || "pending";
    return new CodexSession(thread, initialId);
  }

  async send(text: string, onEvent: Parameters<AdapterSession["send"]>[1], sendOpts?: { model?: string }) {
    const runId = randomUUID();
    return pendingRun(runId, async ({ signal, isCancelled }) => {
      try {
        const extra = sendOpts?.model ? { model: sendOpts.model } : {};
        const { events } = await this.thread.runStreamed(text, { signal, ...extra } as never);
        let status: "finished" | "error" | "cancelled" = "finished";
        for await (const event of events) {
          if (isCancelled()) return "cancelled";
          const tid = threadIdFromEvent(event) || this.thread.id;
          if (tid) this.agentId = tid;
          for (const ev of mapCodexJsonl(event, this.tools, this.snapshots)) {
            onEvent(ev);
            if (ev.type === "run.error") status = "error";
          }
          if (isCodexTurnDone(event) && status === "finished") {
            if (event.type === "turn.failed") status = "error";
          }
        }
        if (this.thread.id) this.agentId = this.thread.id;
        return isCancelled() ? "cancelled" : status;
      } catch (err) {
        if (isCancelled() || (err instanceof Error && err.name === "AbortError")) return "cancelled";
        throw new AdapterError(errorMessage(err), "run");
      }
    });
  }

  async dispose(): Promise<void> {
    /* Thread is persisted under ~/.codex/sessions; nothing to close. */
  }
}

export const codexAdapter: Adapter = {
  id: "codex",
  displayName: "Codex CLI",
  description: "OpenAI Codex SDK (runStreamed / resumeThread). Not print-mode exec.",
  capabilities: {
    models: true,
    sandbox: false,
    settingSources: false,
    autoRun: false,
    cancel: true,
    resume: true,
    discover: false,
    toolConfirmation: "none",
    auth: { kind: "cli-binary", envNames: ["CODEX_API_KEY", "OPENAI_API_KEY"] },
    defaultModel: { id: "gpt-5-codex", params: [] },
    liveCatalog: false,
  },

  normalizeConfig(agent: AgentConfig): AgentConfig {
    return { ...agent, model: agent.model || "gpt-5-codex" };
  },

  async listModels() {
    return {
      models: CODEX_STATIC_CATALOG,
      source: "fallback" as const,
      error: "Codex SDK does not expose a live model catalog",
    };
  },

  async create(opts) {
    try {
      return CodexSession.start(opts);
    } catch (err) {
      throw new AdapterError(`Codex SDK: ${errorMessage(err)}`, "startup");
    }
  },

  async resume(agentId, opts) {
    try {
      return CodexSession.start(opts, agentId);
    } catch (err) {
      throw new AdapterError(`Codex SDK resume: ${errorMessage(err)}`, "startup");
    }
  },
};
