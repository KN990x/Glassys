import type {
  AdapterCapabilities,
  AdapterDiscoverItem,
  ModelCatalogItem,
  ModelListResponse,
  ModelParam,
  ServerMessage,
} from "@glassys/protocol";

export class AdapterError extends Error {
  constructor(
    message: string,
    readonly phase: "startup" | "run" = "startup",
    readonly retryable = false,
  ) {
    super(message);
    this.name = "AdapterError";
  }
}

export interface AdapterModel extends ModelCatalogItem {}

export interface AdapterCreateOptions {
  apiKey?: string;
  cwd: string;
  model: string;
  modelParams: ModelParam[];
  storeDir: string;
  options: Record<string, unknown>;
  /**
   * Directories the agent must not read or write through tools Glassys mediates (the Glassys
   * data dir: secrets, sessions). Without a sandbox a shell can still reach them.
   */
  protectedPaths?: string[];
}

export interface PromptAttachment {
  path: string;
  mime: string;
  name: string;
  body?: Buffer;
}

export type AdapterEventHandler = (event: ServerMessage) => void;

export interface AdapterRun {
  id: string;
  cancel(): Promise<void>;
  wait(): Promise<"finished" | "error" | "cancelled">;
}

export interface AdapterSession {
  agentId: string;
  /** True once the session can no longer send (its child process died); the runtime then opens a new one. */
  readonly closed?: boolean;
  send(
    text: string,
    onEvent: AdapterEventHandler,
    opts?: {
      force?: boolean;
      model?: string;
      modelParams?: ModelParam[];
      attachments?: PromptAttachment[];
    },
  ): Promise<AdapterRun>;
  dispose(): Promise<void>;
}

export interface AdapterLoginOptions {
  onLoginUrl?: (url: string) => void;
  signal?: AbortSignal;
}

export interface Adapter {
  readonly id: string;
  readonly displayName: string;
  readonly description?: string;
  readonly capabilities: AdapterCapabilities;
  /** `ctx` carries the saved options and store when the adapter is the configured one (ACP asks its agent). */
  listModels(apiKey?: string, cwd?: string, ctx?: { options: Record<string, unknown>; storeDir: string }): Promise<ModelListResponse>;
  create(opts: AdapterCreateOptions): Promise<AdapterSession>;
  resume(agentId: string, opts: AdapterCreateOptions): Promise<AdapterSession>;
  normalizeConfig?(agent: {
    adapter: string;
    cwd: string;
    model: string;
    modelParams: ModelParam[];
    options: Record<string, unknown>;
  }): {
    adapter: string;
    cwd: string;
    model: string;
    modelParams: ModelParam[];
    options: Record<string, unknown>;
  };
  /** Optional host check (missing SDK, missing binary). Throw if the adapter cannot create/send. */
  probe?(options?: Record<string, unknown>): Promise<void>;
  /**
   * When `capabilities.resume` is false, the runtime may still call `resume` if this returns true
   * (ACP: child advertised session load/resume on a previous initialize).
   */
  shouldResume?(agentId: string, opts: AdapterCreateOptions): Promise<boolean>;
  loginInteractive?(opts?: AdapterLoginOptions): Promise<void>;
  authStatus?(): Promise<{ loggedIn: boolean; email?: string }>;
  discover?(): Promise<AdapterDiscoverItem[]>;
  /** Process-level teardown (shared servers). Session dispose stays on AdapterSession. */
  shutdown?(): Promise<void>;
}
