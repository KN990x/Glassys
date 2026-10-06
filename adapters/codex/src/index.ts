import { randomUUID } from "node:crypto";
import { Codex } from "@openai/codex-sdk";
import {
  AdapterError,
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
import { isCodexTurnDone, mapCodexJsonl, threadIdFromEvent } from "./mapper.js";

export const CODEX_STATIC_CATALOG: ModelCatalogItem[] = [
  { id: "gpt-5.6-sol", displayName: "GPT-5.6 Sol" },
  { id: "gpt-5.6-terra", displayName: "GPT-5.6 Terra" },
  { id: "gpt-5.6-luna", displayName: "GPT-5.6 Luna" },
];

/** Codex's sandbox levels, most restrictive first (`--sandbox`). */
export const CODEX_SANDBOX_MODES = ["read-only", "workspace-write", "danger-full-access"] as const;
type CodexSandboxMode = (typeof CODEX_SANDBOX_MODES)[number];

/** The operator's pick, or undefined to leave it to ~/.codex/config.toml (Codex's own default). */
export function codexSandboxMode(options: Record<string, unknown> | undefined): CodexSandboxMode | undefined {
  const raw = options?.sandboxMode;
  return typeof raw === "string" && (CODEX_SANDBOX_MODES as readonly string[]).includes(raw)
    ? (raw as CodexSandboxMode)
    : undefined;
}

function threadOpts(opts: AdapterCreateOptions) {
  const sandboxMode = codexSandboxMode(opts.options);
  return {
    workingDirectory: opts.cwd,
    skipGitRepoCheck: true,
    ...(opts.model ? { model: opts.model } : {}),
    ...(sandboxMode ? { sandboxMode } : {}),
  };
}

class CodexSession implements AdapterSession {
  private tools = new Map<string, string>();
  private snapshots = new Map<string, string>();
  agentId: string;

  constructor(
    private client: Codex,
    private thread: ReturnType<Codex["startThread"]>,
    agentId: string,
    private opts: AdapterCreateOptions,
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
    return new CodexSession(client, thread, initialId, opts);
  }

  /**
   * A Codex thread takes its model when it is opened; a turn cannot override it. A new model
   * reopens the same thread with it, so the switch is sticky from this send on and the
   * conversation carries over.
   */
  private retarget(model: string): void {
    if (!model || model === this.opts.model) return;
    this.opts = { ...this.opts, model };
    const id = this.thread.id || (this.agentId !== "pending" ? this.agentId : "");
    this.thread = id ? this.client.resumeThread(id, threadOpts(this.opts)) : this.client.startThread(threadOpts(this.opts));
  }

  /** The model the next turn runs on (for tests). */
  get model(): string {
    return this.opts.model;
  }

  async send(
    text: string,
    onEvent: Parameters<AdapterSession["send"]>[1],
    sendOpts?: { model?: string; attachments?: PromptAttachment[] },
  ) {
    const prompt = promptWithAttachments(text, sendOpts?.attachments);
    if (sendOpts?.model) this.retarget(sendOpts.model);
    const runId = randomUUID();
    return pendingRun(runId, async ({ signal, isCancelled }) => {
      try {
        const { events } = await this.thread.runStreamed(prompt, { signal });
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
  displayName: "Codex",
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
    attachments: false,
    auth: { kind: "cli-binary", envNames: ["CODEX_API_KEY", "OPENAI_API_KEY"] },
    defaultModel: { id: "gpt-5.6-sol", params: [] },
    liveCatalog: false,
    sandboxModes: [...CODEX_SANDBOX_MODES],
  },

  normalizeConfig(agent: AgentConfig): AgentConfig {
    const options = { ...(agent.options ?? {}) };
    if (!codexSandboxMode(options)) delete options.sandboxMode;
    return { ...agent, model: agent.model || "gpt-5.6-sol", options };
  },

  async listModels() {
    return {
      models: CODEX_STATIC_CATALOG,
      source: "fallback" as const,
    };
  },

  async probe() {
    await requireHostCommand("codex", "Codex CLI is not on PATH. Install the Codex CLI on this host.");
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
