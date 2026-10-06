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
import { claudeRunStatus, claudeSessionId, isClaudeResult, mapClaudeMessage } from "./mapper.js";

export const CLAUDE_STATIC_CATALOG: ModelCatalogItem[] = [
  { id: "opus", displayName: "Opus" },
  { id: "sonnet", displayName: "Sonnet" },
  { id: "haiku", displayName: "Haiku" },
];

type QueryHandle = {
  interrupt?: () => Promise<void>;
  close?: () => void;
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

function waitUntil(pred: () => boolean, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setInterval(() => {
      if (pred()) done();
    }, 50);
    if (signal.aborted || pred()) {
      done();
      return;
    }
    signal.addEventListener("abort", done);
  });
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

function queryOptions(opts: AdapterCreateOptions, extra: Record<string, unknown> = {}) {
  const autoRun = optionBool(opts.options, "autoRun", true);
  const permissionMode =
    optionString(opts.options, "permissionMode", "") || (autoRun ? "bypassPermissions" : "dontAsk");
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

class ClaudeSession implements AdapterSession {
  private tools = new Map<string, string>();
  agentId: string;
  private model: string;
  private opts: AdapterCreateOptions;
  /** The Claude process ended, crashed or was closed: nothing will read the next prompt. */
  private ended = false;

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
  }

  static async start(opts: AdapterCreateOptions, resumeId?: string): Promise<ClaudeSession> {
    const sdk = await loadSdk();
    const queue = new PromptQueue();
    const query = sdk.query({
      prompt: queue,
      options: queryOptions(opts, resumeId ? { resume: resumeId } : {}),
    });
    return new ClaudeSession(query, resumeId && usableSessionId(resumeId) ? resumeId : "", queue, query[Symbol.asyncIterator](), opts);
  }

  private async retarget(model: string): Promise<void> {
    if (model === this.model) return;
    this.queue.close();
    try {
      this.query.close?.();
    } catch {
      /* ignore */
    }
    const sdk = await loadSdk();
    const nextOpts = { ...this.opts, model };
    this.opts = nextOpts;
    this.model = model;
    this.queue = new PromptQueue();
    this.query = sdk.query({
      prompt: this.queue,
      options: queryOptions(nextOpts, usableSessionId(this.agentId) ? { resume: this.agentId } : {}),
    });
    this.iterator = this.query[Symbol.asyncIterator]();
    this.ended = false;
  }

  async send(
    text: string,
    onEvent: Parameters<AdapterSession["send"]>[1],
    sendOpts?: { model?: string; attachments?: PromptAttachment[] },
  ) {
    if (sendOpts?.model) await this.retarget(sendOpts.model);
    const id = randomUUID();
    this.queue.push(text, sendOpts?.attachments);
    const query = this.query;
    const iterator = this.iterator;
    const tools = this.tools;
    return pendingRun(id, async ({ isCancelled }) => {
      let stop = false;
      let cancelledAt = 0;
      const watch = (async () => {
        while (!isCancelled() && !stop) await new Promise((r) => setTimeout(r, 50));
        if (!isCancelled()) return;
        cancelledAt = Date.now();
        try {
          await query.interrupt?.();
        } catch {
          /* ignore */
        }
      })();
      const cancelExpired = () =>
        isCancelled() && cancelledAt > 0 && Date.now() - cancelledAt > CLAUDE_CANCEL_TIMEOUT_MS;
      /* An async iterator takes one next() at a time; a tick must not start a second one. */
      let pending: Promise<{ kind: "msg"; v: Awaited<ReturnType<typeof iterator.next>> }> | null = null;
      try {
        const mapState = { sawStreamEvent: false };
        while (!stop) {
          if (cancelExpired()) {
            try {
              query.close?.();
            } catch {
              /* ignore */
            }
            this.ended = true;
            return "cancelled";
          }
          if (!pending) {
            pending = iterator.next().then((v) => ({ kind: "msg" as const, v }));
            pending.catch(() => undefined);
          }
          const abortTick = new AbortController();
          const next = await Promise.race([
            pending,
            waitUntil(() => stop || cancelExpired(), abortTick.signal).then(() => ({ kind: "tick" as const })),
          ]);
          abortTick.abort();
          if (next.kind === "tick") continue;
          pending = null;
          if (next.v.done) {
            this.ended = true;
            return isCancelled() ? "cancelled" : "finished";
          }
          const sid = claudeSessionId(next.v.value);
          if (sid) this.agentId = sid;
          for (const event of mapClaudeMessage(next.v.value, tools, mapState)) onEvent(event);
          /*
           * A cancelled turn still ends with its own result once the interrupt lands. Read up to
           * it: returning earlier left that result queued, and the next send took it for its own
           * answer and finished at once, one turn out of step from then on.
           */
          if (isClaudeResult(next.v.value)) return claudeRunStatus(isCancelled(), next.v.value);
        }
        return isCancelled() ? "cancelled" : "finished";
      } catch (err) {
        /* The iterator threw: the Claude process is gone. */
        this.ended = true;
        throw err;
      } finally {
        stop = true;
        void watch;
      }
    });
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
        autoRun: optionBool(agent.options, "autoRun", true),
        permissionMode: optionString(agent.options, "permissionMode", optionBool(agent.options, "autoRun", true) ? "bypassPermissions" : "dontAsk"),
        ...agent.options,
      },
    };
  },

  async listModels(apiKey?: string, cwd?: string) {
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
