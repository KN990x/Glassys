import { Agent, Cursor, JsonlLocalAgentStore } from "@cursor/sdk";
import { AdapterError, type Adapter, type AdapterCreateOptions, type AdapterEventHandler, type AdapterRun, type AdapterSession } from "@glassys/adapter-contract";
import { optionBool, optionStringArray, type AgentConfig, type ModelParam, type SettingSource } from "@glassys/protocol";
import { mapCursorDelta } from "./mapper.js";
import { runResultErrorMessage, wrapSdkError } from "./errors.js";
import {
  CURSOR_DEFAULT_MODEL,
  CURSOR_FLAGSHIP_MODEL_ID,
  cursorCatalogFromListed,
  cursorFallbackCatalog,
  normalizeCursorConfig,
} from "./catalog.js";

export { AdapterError } from "@glassys/adapter-contract";
export { wrapSdkError, runResultErrorMessage } from "./errors.js";

function settingSources(opts: AdapterCreateOptions): SettingSource[] {
  const raw = optionStringArray(opts.options, "settingSources", ["project", "user"]);
  return raw.filter(
    (s): s is SettingSource =>
      s === "project" || s === "user" || s === "plugins" || s === "team" || s === "mdm" || s === "all",
  );
}

function localOpts(opts: AdapterCreateOptions) {
  return {
    cwd: opts.cwd,
    settingSources: settingSources(opts),
    sandboxOptions: { enabled: optionBool(opts.options, "sandbox", false) },
    autoReview: !optionBool(opts.options, "autoRun", true),
    store: new JsonlLocalAgentStore(opts.storeDir),
  };
}

/** SDK 1.0.x LocalSendOptions only documents `force`. Extra local fields are best-effort; force is the recovery path. */
export function localForSend(opts: AdapterCreateOptions, force?: boolean) {
  if (!force) return undefined;
  return { ...localOpts(opts), force: true as const };
}

function agentOptions(opts: AdapterCreateOptions) {
  const model = {
    id: opts.model || CURSOR_FLAGSHIP_MODEL_ID,
    params: opts.modelParams?.length ? opts.modelParams : undefined,
  };
  return {
    ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
    model,
    name: "Glassys",
    local: localOpts(opts),
  };
}

class CursorSession implements AdapterSession {
  constructor(
    private agent: Awaited<ReturnType<typeof Agent.create>>,
    readonly agentId: string,
    private opts: AdapterCreateOptions,
  ) {}

  async send(
    text: string,
    onEvent: AdapterEventHandler,
    sendOpts?: { force?: boolean; model?: string; modelParams?: ModelParam[] },
  ): Promise<AdapterRun> {
    let run: Awaited<ReturnType<typeof this.agent.send>>;
    try {
      run = await this.agent.send(text, {
        model: sendOpts?.model
          ? {
              id: sendOpts.model,
              params: sendOpts.modelParams?.length ? sendOpts.modelParams : undefined,
            }
          : undefined,
        onDelta: ({ update }) => {
          for (const event of mapCursorDelta(update)) onEvent(event);
        },
        local: localForSend(this.opts, sendOpts?.force),
      });
    } catch (err) {
      wrapSdkError(err, "run");
    }

    return {
      id: run.id,
      cancel: async () => {
        if (!run.supports("cancel")) {
          throw new AdapterError("This Cursor run cannot be cancelled", "run");
        }
        await run.cancel();
      },
      wait: async () => {
        try {
          const result = await run.wait();
          if (result.status === "cancelled") return "cancelled";
          if (result.status === "error") {
            onEvent({ type: "run.error", message: runResultErrorMessage(result), phase: "run" });
            return "error";
          }
          return "finished";
        } catch (err) {
          wrapSdkError(err, "run");
        }
      },
    };
  }

  async dispose(): Promise<void> {
    await this.agent[Symbol.asyncDispose]();
  }
}

export const cursorAdapter: Adapter = {
  id: "cursor",
  displayName: "Cursor",
  description: "Local Cursor SDK. Thinking, tools, and diffs from onDelta.",
  capabilities: {
    models: true,
    sandbox: true,
    settingSources: true,
    autoRun: true,
    cancel: true,
    resume: true,
    discover: false,
    toolConfirmation: "auto-review-deny",
    auth: { kind: "sdk-login", envNames: ["CURSOR_API_KEY"] },
    defaultModel: CURSOR_DEFAULT_MODEL,
    liveCatalog: true,
  },

  normalizeConfig(agent: AgentConfig): AgentConfig {
    return normalizeCursorConfig(agent);
  },

  async listModels(apiKey?: string) {
    try {
      const listed = await Cursor.models.list(apiKey ? { apiKey } : undefined);
      return cursorCatalogFromListed(listed);
    } catch (err) {
      return cursorFallbackCatalog(err instanceof Error ? err.message : String(err));
    }
  },

  async create(opts: AdapterCreateOptions): Promise<AdapterSession> {
    try {
      const agent = await Agent.create(agentOptions(opts));
      return new CursorSession(agent, agent.agentId, opts);
    } catch (err) {
      wrapSdkError(err, "startup");
    }
  },

  async resume(agentId: string, opts: AdapterCreateOptions): Promise<AdapterSession> {
    try {
      const agent = await Agent.resume(agentId, agentOptions(opts));
      return new CursorSession(agent, agent.agentId, opts);
    } catch (err) {
      wrapSdkError(err, "startup");
    }
  },

  async loginInteractive(): Promise<void> {
    await Cursor.auth.login();
  },

  async authStatus(): Promise<{ loggedIn: boolean; email?: string }> {
    try {
      const status = await Cursor.auth.status();
      if (status && typeof status === "object" && "status" in status) {
        const rec = status as { status?: string; email?: string };
        return { loggedIn: rec.status === "logged-in", email: rec.email };
      }
    } catch {
      /* ignore */
    }
    return { loggedIn: false };
  },
};

export { mapCursorDelta } from "./mapper.js";
export {
  CURSOR_FLAGSHIP_MODEL_ID,
  CURSOR_STATIC_CATALOG,
  CURSOR_DEFAULT_MODEL,
  cursorParamsForFlagship,
  cursorCatalogFromListed,
  parseCursorModelList,
  normalizeCursorConfig,
} from "./catalog.js";
export type { Adapter, AdapterSession, AdapterCreateOptions, AdapterRun } from "@glassys/adapter-contract";
