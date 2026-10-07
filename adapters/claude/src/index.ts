import { randomUUID } from "node:crypto";
import {
  AdapterError,
  PROTECTED_PATH_DENIAL,
  commandTouchesProtectedPath,
  errorMessage,
  isProtectedPath,
  imagePartsFromAttachments,
  pendingRun,
  promptWithAttachments,
  type Adapter,
  type AdapterCreateOptions,
  type AdapterSession,
  type PromptAttachment,
} from "@glassys/adapter-contract";
import { mergeModelCatalog, optionBool, optionString, type AgentConfig, type ModelCatalogItem } from "@glassys/protocol";
import { claudeMapState, claudeRunStatus, claudeSessionId, isClaudeResult, mapClaudeMessage } from "./mapper.js";

export const CLAUDE_STATIC_CATALOG: ModelCatalogItem[] = [
  { id: "opus", displayName: "Opus" },
  { id: "sonnet", displayName: "Sonnet" },
  { id: "haiku", displayName: "Haiku" },
];

type QueryHandle = {
  interrupt?: () => Promise<void>;
  close?: () => void;
  setModel?: (model?: string) => Promise<void>;
  supportedModels?: () => Promise<Array<{ value?: string; displayName?: string; id?: string; name?: string }>>;
  [Symbol.asyncIterator]: () => AsyncIterator<unknown>;
};

async function loadSdk(): Promise<{
  query: (args: { prompt: unknown; options: Record<string, unknown> }) => QueryHandle;
}> {
  try {
    return (await import("@anthropic-ai/claude-agent-sdk")) as {
      query: (args: { prompt: unknown; options: Record<string, unknown> }) => QueryHandle;
    };
  } catch (err) {
    throw new AdapterError(
      `Claude Agent SDK is not available: ${errorMessage(err)}. Install @anthropic-ai/claude-agent-sdk on the gateway host.`,
      "startup",
    );
  }
}

export const CLAUDE_CANCEL_TIMEOUT_MS = 20_000;

export function claudeUserContent(
  text: string,
  attachments?: { path: string; mime: string; name: string; body?: Buffer }[],
): string | Array<Record<string, unknown>> {
  const note = promptWithAttachments(text, attachments);
  const images = imagePartsFromAttachments(attachments);
  if (images.length === 0) return note;
  return [
    { type: "text", text: note },
    ...images.map((a) => ({
      type: "image",
      source: { type: "base64", media_type: a.mime, data: a.data },
    })),
  ];
}

class PromptQueue {
  private items: Array<Record<string, unknown>> = [];
  private waiters: Array<(v: IteratorResult<Record<string, unknown>>) => void> = [];
  private closed = false;

  push(text: string, attachments?: { path: string; mime: string; name: string; body?: Buffer }[]) {
    const content = claudeUserContent(text, attachments);
    const msg = {
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
    };
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: msg, done: false });
    else this.items.push(msg);
  }

  close() {
    this.closed = true;
    for (const w of this.waiters) w({ value: undefined as unknown as Record<string, unknown>, done: true });
    this.waiters = [];
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Record<string, unknown>> {
    while (true) {
      if (this.items.length) {
        yield this.items.shift()!;
        continue;
      }
      if (this.closed) return;
      const next = await new Promise<IteratorResult<Record<string, unknown>>>((resolve) => this.waiters.push(resolve));
      if (next.done) return;
      yield next.value;
    }
  }
}

function usableSessionId(id: string | undefined): id is string {
  return Boolean(id) && id !== "pending";
}

/** Tool input fields that name a file or directory, across Claude's built-in tools. */
const PATH_FIELDS = ["file_path", "notebook_path", "path"] as const;

/**
 * Whether a Claude tool call names a protected directory. File tools are checked by their path
 * fields (and Glob by its pattern); Bash by the command text. A search rooted above the
 * directory (Grep over $HOME) is not blocked: that would block every search from a home cwd.
 */
export function claudeToolTouchesProtected(
  toolName: string,
  toolInput: unknown,
  cwd: string,
  protectedPaths: readonly string[] | undefined,
): boolean {
  if (!protectedPaths?.length || !toolInput || typeof toolInput !== "object") return false;
  const input = toolInput as Record<string, unknown>;
  if (toolName === "Bash" || toolName === "BashOutput") {
    return typeof input.command === "string" && commandTouchesProtectedPath(input.command, cwd, protectedPaths);
  }
  const base = typeof input.path === "string" && input.path ? input.path : cwd;
  for (const field of PATH_FIELDS) {
    const value = input[field];
    if (typeof value === "string" && value && isProtectedPath(value, cwd, protectedPaths)) return true;
  }
  if (toolName === "Glob" && typeof input.pattern === "string") {
    // The literal prefix of the pattern, before its first wildcard.
    if (isProtectedPath(input.pattern.replace(/[*?{[].*$/, ""), base, protectedPaths)) return true;
  }
  return false;
}

/**
 * PreToolUse runs in every permission mode, bypassPermissions included, so this holds even with
 * auto-run on. It is not a sandbox: a shell can still reach the directory some other way.
 */
function protectedPathHooks(opts: AdapterCreateOptions) {
  if (!opts.protectedPaths?.length) return {};
  return {
    hooks: {
      PreToolUse: [
        {
          hooks: [
            async (input: { tool_name?: string; tool_input?: unknown; cwd?: string }) => {
              if (!claudeToolTouchesProtected(input.tool_name ?? "", input.tool_input, input.cwd || opts.cwd, opts.protectedPaths)) {
                return {};
              }
              return {
                hookSpecificOutput: {
                  hookEventName: "PreToolUse" as const,
                  permissionDecision: "deny" as const,
                  permissionDecisionReason: PROTECTED_PATH_DENIAL,
                },
              };
            },
          ],
        },
      ],
    },
  };
}

/**
 * The permission mode Claude runs under. Auto-run off never yields `bypassPermissions`, whatever
 * mode was stored: that pairing would let every tool run while Settings says auto-run is off.
 */
export function claudePermissionMode(options: Record<string, unknown> | undefined): string {
  const autoRun = optionBool(options, "autoRun", true);
  const stored = optionString(options, "permissionMode", "");
  if (!autoRun) return stored && stored !== "bypassPermissions" ? stored : "dontAsk";
  return stored || "bypassPermissions";
}

function queryOptions(opts: AdapterCreateOptions, extra: Record<string, unknown> = {}) {
  const permissionMode = claudePermissionMode(opts.options);
  return {
    ...protectedPathHooks(opts),
    cwd: opts.cwd,
    model: opts.model || "sonnet",
    includePartialMessages: true,
    permissionMode,
    allowDangerouslySkipPermissions: permissionMode === "bypassPermissions",
    ...(opts.apiKey ? { env: { ...process.env, ANTHROPIC_API_KEY: opts.apiKey } } : {}),
    ...extra,
  };
}

/** What Claude Code says when asked to resume a conversation it does not have. */
const MISSING_SESSION = /no conversation found|session.*not found/i;

class ClaudeSession implements AdapterSession {
  agentId: string;
  private model: string;
  private opts: AdapterCreateOptions;
  /** The Claude process ended, crashed or was closed: nothing will read the next prompt. */
  private ended = false;
  /** Started with `resume` and no turn has gone through yet: a missing session shows up here. */
  private resumeUnconfirmed: boolean;

  get closed(): boolean {
    return this.ended;
  }

  constructor(
    private query: QueryHandle,
    agentId: string,
    private queue: PromptQueue,
    private iterator: AsyncIterator<unknown>,
    opts: AdapterCreateOptions,
  ) {
    this.agentId = agentId;
    this.model = opts.model || "sonnet";
    this.opts = opts;
    this.resumeUnconfirmed = usableSessionId(agentId);
  }

  static async start(opts: AdapterCreateOptions, resumeId?: string): Promise<ClaudeSession> {
    const sdk = await loadSdk();
    const queue = new PromptQueue();
    const resume = usableSessionId(resumeId) ? resumeId : undefined;
    const query = sdk.query({
      prompt: queue,
      options: queryOptions(opts, resume ? { resume } : {}),
    });
    return new ClaudeSession(query, resume ?? "", queue, query[Symbol.asyncIterator](), opts);
  }

  /** Replace the Claude process, resuming this conversation unless `fresh`. */
  private async restart(opts: AdapterCreateOptions, fresh = false): Promise<void> {
    this.queue.close();
    try {
      this.query.close?.();
    } catch {
      /* ignore */
    }
    const sdk = await loadSdk();
    this.opts = opts;
    this.queue = new PromptQueue();
    if (fresh) this.agentId = "";
    this.query = sdk.query({
      prompt: this.queue,
      options: queryOptions(opts, usableSessionId(this.agentId) ? { resume: this.agentId } : {}),
    });
    this.iterator = this.query[Symbol.asyncIterator]();
    this.ended = false;
  }

  /** Switch model in place when the SDK can; otherwise restart the process on the new model. */
  private async retarget(model: string): Promise<void> {
    if (model === this.model) return;
    this.model = model;
    if (this.query.setModel && !this.ended) {
      try {
        await this.query.setModel(model);
        this.opts = { ...this.opts, model };
        return;
      } catch {
        /* fall back to a restart */
      }
    }
    await this.restart({ ...this.opts, model });
  }

  async send(
    text: string,
    onEvent: Parameters<AdapterSession["send"]>[1],
    sendOpts?: { model?: string; attachments?: PromptAttachment[] },
  ) {
    if (sendOpts?.model) await this.retarget(sendOpts.model);
    const id = randomUUID();
    return pendingRun(id, async ({ signal, isCancelled }) => {
      const first = await this.turn(text, sendOpts?.attachments, onEvent, signal, isCancelled, this.resumeUnconfirmed);
      if (first !== "missing-session") return first;
      /* The stored conversation is gone (pruned, another machine): start a new one and send again. */
      await this.restart(this.opts, true);
      const retry = await this.turn(text, sendOpts?.attachments, onEvent, signal, isCancelled, false);
      return retry === "missing-session" ? "error" : retry;
    });
  }

  /**
   * One prompt, read up to its result. A cancelled turn still ends with its own result once the
   * interrupt lands; returning earlier left that result queued, and the next send took it for its
   * own answer and finished at once, one turn out of step from then on.
   */
  private async turn(
    text: string,
    attachments: PromptAttachment[] | undefined,
    onEvent: Parameters<AdapterSession["send"]>[1],
    signal: AbortSignal,
    isCancelled: () => boolean,
    probeResume: boolean,
  ): Promise<"finished" | "error" | "cancelled" | "missing-session"> {
    this.queue.push(text, attachments);
    const query = this.query;
    const iterator = this.iterator;
    const mapState = claudeMapState();
    let expireTimer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<"expired">((resolve) => {
      const onAbort = () => {
        void query.interrupt?.().catch(() => undefined);
        expireTimer = setTimeout(() => resolve("expired"), CLAUDE_CANCEL_TIMEOUT_MS);
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      for (;;) {
        const next = await Promise.race([iterator.next(), expired]);
        if (next === "expired") {
          try {
            query.close?.();
          } catch {
            /* ignore */
          }
          this.ended = true;
          return "cancelled";
        }
        if (next.done) {
          this.ended = true;
          return isCancelled() ? "cancelled" : "finished";
        }
        const message = next.value;
        if (probeResume && isClaudeResult(message)) {
          const errors = (message as { errors?: unknown }).errors;
          if (Array.isArray(errors) && errors.some((e) => MISSING_SESSION.test(String(e)))) return "missing-session";
        }
        const sid = claudeSessionId(message);
        if (sid) this.agentId = sid;
        for (const event of mapClaudeMessage(message, mapState)) onEvent(event);
        if (isClaudeResult(message)) {
          this.resumeUnconfirmed = false;
          return claudeRunStatus(isCancelled(), message);
        }
      }
    } catch (err) {
      /* The iterator threw: the Claude process is gone. */
      this.ended = true;
      if (probeResume && MISSING_SESSION.test(errorMessage(err))) return "missing-session";
      throw err;
    } finally {
      if (expireTimer) clearTimeout(expireTimer);
    }
  }

  async dispose(): Promise<void> {
    this.queue.close();
    try {
      this.query.close?.();
    } catch {
      /* ignore */
    }
  }
}

export function claudeCatalogFromListed(listed: unknown[]): {
  models: ModelCatalogItem[];
  source: "live" | "fallback";
  error?: string;
} {
  const mapped = mapListedModels(listed);
  if (!mapped.length) {
    return { models: CLAUDE_STATIC_CATALOG, source: "fallback", error: "supportedModels returned empty" };
  }
  return { models: mergeModelCatalog(mapped, CLAUDE_STATIC_CATALOG), source: "live" };
}

function mapListedModels(raw: unknown[]): ModelCatalogItem[] {
  const out: ModelCatalogItem[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      out.push({ id: item, displayName: item });
      continue;
    }
    if (item && typeof item === "object") {
      const rec = item as Record<string, unknown>;
      const id = typeof rec.value === "string" ? rec.value : typeof rec.id === "string" ? rec.id : typeof rec.name === "string" ? rec.name : "";
      if (!id) continue;
      out.push({
        id,
        displayName: typeof rec.displayName === "string" ? rec.displayName : id,
        description: typeof rec.description === "string" ? rec.description : undefined,
      });
    }
  }
  return out;
}

export const claudeAdapter: Adapter = {
  id: "claude",
  displayName: "Claude Code",
  description: "Anthropic Claude Agent SDK (local Claude Code runtime).",
  capabilities: {
    models: true,
    sandbox: false,
    settingSources: false,
    autoRun: true,
    cancel: true,
    resume: true,
    discover: false,
    toolConfirmation: "permission-mode",
    attachments: true,
    auth: { kind: "api-key", envNames: ["ANTHROPIC_API_KEY"] },
    defaultModel: { id: "sonnet", params: [] },
    liveCatalog: true,
  },

  normalizeConfig(agent: AgentConfig): AgentConfig {
    return {
      ...agent,
      model: agent.model || "sonnet",
      options: {
        ...agent.options,
        autoRun: optionBool(agent.options, "autoRun", true),
        permissionMode: claudePermissionMode(agent.options),
      },
    };
  },

  async listModels(apiKey?: string, cwd?: string) {
    /* Each listing starts a whole Claude Code process; the catalog changes on the order of days. */
    const key = `${apiKey ?? ""}\u0000${cwd ?? ""}`;
    const cached = catalogCache.get(key);
    if (cached && Date.now() - cached.at < CLAUDE_CATALOG_TTL_MS) return cached.value;
    const value = await listClaudeModels(apiKey, cwd);
    if (value.source === "live") catalogCache.set(key, { at: Date.now(), value });
    return value;
  },

  async probe() {
    await loadSdk();
  },

  async create(opts) {
    return ClaudeSession.start(opts);
  },

  async resume(agentId, opts) {
    return ClaudeSession.start(opts, agentId);
  },
};

export const CLAUDE_CATALOG_TTL_MS = 10 * 60_000;
const catalogCache = new Map<string, { at: number; value: Awaited<ReturnType<typeof listClaudeModels>> }>();

async function listClaudeModels(apiKey?: string, cwd?: string) {
  try {
    const sdk = await loadSdk();
    const q = sdk.query({
      prompt: (async function* () {})(),
      options: {
        cwd: cwd || process.cwd(),
        maxTurns: 0,
        ...(apiKey ? { env: { ...process.env, ANTHROPIC_API_KEY: apiKey } } : {}),
      },
    });
    try {
      return claudeCatalogFromListed(q.supportedModels ? await q.supportedModels() : []);
    } finally {
      q.close?.();
    }
  } catch (err) {
    return { models: CLAUDE_STATIC_CATALOG, source: "fallback" as const, error: errorMessage(err) };
  }
}
