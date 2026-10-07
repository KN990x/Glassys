import { randomUUID } from "node:crypto";
import { Codex } from "@openai/codex-sdk";
import {
  AdapterError,
  errorMessage,
  pendingRun,
  promptWithAttachments,
  type Adapter,
  type AdapterCreateOptions,
  type AdapterSession,
  type PromptAttachment,
} from "@glassys/adapter-contract";
import { type AgentConfig, type ModelCatalogItem, type ModelParam } from "@glassys/protocol";
import { codexMapState, mapCodexJsonl, threadIdFromEvent } from "./mapper.js";

/** Codex's `model_reasoning_effort`, offered as the `effort` parameter. */
export const CODEX_EFFORTS = ["low", "medium", "high", "xhigh"] as const;
type CodexEffort = (typeof CODEX_EFFORTS)[number];

const EFFORT_PARAM = {
  id: "effort",
  displayName: "Effort",
  values: [
    { value: "low", displayName: "Low" },
    { value: "medium", displayName: "Medium" },
    { value: "high", displayName: "High" },
    { value: "xhigh", displayName: "Extra high" },
  ],
};

export const CODEX_STATIC_CATALOG: ModelCatalogItem[] = [
  { id: "gpt-5.6-sol", displayName: "GPT-5.6 Sol", parameters: [EFFORT_PARAM] },
  { id: "gpt-5.6-terra", displayName: "GPT-5.6 Terra", parameters: [EFFORT_PARAM] },
  { id: "gpt-5.6-luna", displayName: "GPT-5.6 Luna", parameters: [EFFORT_PARAM] },
];

/** The operator's effort pick, or undefined to leave it to ~/.codex/config.toml. */
export function codexEffort(params: ModelParam[] | undefined): CodexEffort | undefined {
  const value = params?.find((p) => p.id === "effort")?.value;
  return (CODEX_EFFORTS as readonly string[]).includes(value ?? "") ? (value as CodexEffort) : undefined;
}

/** What the Codex CLI says when asked to resume a thread it does not have. */
const MISSING_THREAD = /no (rollout|thread|session|conversation) found|not found.*(thread|session|rollout)/i;

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
  const effort = codexEffort(opts.modelParams);
  return {
    workingDirectory: opts.cwd,
    skipGitRepoCheck: true,
    ...(opts.model ? { model: opts.model } : {}),
    ...(sandboxMode ? { sandboxMode } : {}),
    ...(effort ? { modelReasoningEffort: effort } : {}),
  };
}

class CodexSession implements AdapterSession {
  agentId: string;
  /** Opened with resumeThread and no turn has gone through yet: a missing thread shows up here. */
  private resumeUnconfirmed: boolean;

  constructor(
    private client: Codex,
    private thread: ReturnType<Codex["startThread"]>,
    agentId: string,
    private opts: AdapterCreateOptions,
  ) {
    this.agentId = agentId;
    this.resumeUnconfirmed = agentId !== "pending";
  }

  static start(opts: AdapterCreateOptions, resumeId?: string): CodexSession {
    const client = new Codex(opts.apiKey ? { apiKey: opts.apiKey } : {});
    const resume = resumeId && resumeId !== "pending" ? resumeId : undefined;
    const thread = resume ? client.resumeThread(resume, threadOpts(opts)) : client.startThread(threadOpts(opts));
    return new CodexSession(client, thread, resume ?? (thread.id || "pending"), opts);
  }

  /**
   * A Codex thread takes its model and effort when it is opened; a turn cannot override them.
   * A change reopens the same thread with them, so the switch is sticky from this send on and
   * the conversation carries over.
   */
  private retarget(model: string | undefined, modelParams: ModelParam[] | undefined): void {
    const nextModel = model || this.opts.model;
    const nextParams = modelParams ?? this.opts.modelParams;
    if (nextModel === this.opts.model && codexEffort(nextParams) === codexEffort(this.opts.modelParams)) return;
    this.opts = { ...this.opts, model: nextModel, modelParams: nextParams };
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
    sendOpts?: { model?: string; modelParams?: ModelParam[]; attachments?: PromptAttachment[] },
  ) {
    this.retarget(sendOpts?.model, sendOpts?.modelParams);
    const images = (sendOpts?.attachments ?? []).filter((a) => a.mime.startsWith("image/"));
    const prompt = promptWithAttachments(text, sendOpts?.attachments);
    const input = images.length
      ? [{ type: "text" as const, text: prompt }, ...images.map((a) => ({ type: "local_image" as const, path: a.path }))]
      : prompt;
    const runId = randomUUID();
    return pendingRun(runId, async ({ signal, isCancelled }) => {
      const first = await this.turn(input, onEvent, signal, isCancelled, this.resumeUnconfirmed);
      if (first !== "missing-thread") return first;
      /* The stored thread is gone: start a new one and send again. */
      this.thread = this.client.startThread(threadOpts(this.opts));
      this.agentId = "pending";
      const retry = await this.turn(input, onEvent, signal, isCancelled, false);
      return retry === "missing-thread" ? "error" : retry;
    });
  }

  private async turn(
    input: Parameters<ReturnType<Codex["startThread"]>["runStreamed"]>[0],
    onEvent: Parameters<AdapterSession["send"]>[1],
    signal: AbortSignal,
    isCancelled: () => boolean,
    probeResume: boolean,
  ): Promise<"finished" | "error" | "cancelled" | "missing-thread"> {
    const state = codexMapState();
    try {
      const { events } = await this.thread.runStreamed(input, { signal });
      let status: "finished" | "error" | "cancelled" = "finished";
      for await (const event of events) {
        if (isCancelled()) return "cancelled";
        if (probeResume && (event.type === "turn.failed" || event.type === "error")) {
          const message = event.type === "error" ? event.message : event.error.message;
          if (MISSING_THREAD.test(message)) return "missing-thread";
        }
        const tid = threadIdFromEvent(event) || this.thread.id;
        if (tid) this.agentId = tid;
        for (const ev of mapCodexJsonl(event, state)) {
          onEvent(ev);
          if (ev.type === "run.error") status = "error";
        }
      }
      if (this.thread.id) this.agentId = this.thread.id;
      this.resumeUnconfirmed = false;
      return isCancelled() ? "cancelled" : status;
    } catch (err) {
      if (isCancelled() || (err instanceof Error && err.name === "AbortError")) return "cancelled";
      if (probeResume && MISSING_THREAD.test(errorMessage(err))) return "missing-thread";
      throw new AdapterError(errorMessage(err), "run");
    }
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
    attachments: true,
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

  /**
   * The SDK runs the Codex binary that ships with its own `@openai/codex` dependency, not one on
   * PATH; constructing a client is what resolves it.
   */
  async probe() {
    try {
      new Codex();
    } catch (err) {
      throw new AdapterError(`Codex SDK cannot find its CLI binary: ${errorMessage(err)}`, "startup");
    }
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
