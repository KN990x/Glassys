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
}

export type AdapterEventHandler = (event: ServerMessage) => void;

export interface AdapterRun {
  id: string;
  cancel(): Promise<void>;
  wait(): Promise<"finished" | "error" | "cancelled">;
}

export interface AdapterSession {
  agentId: string;
  send(
    text: string,
    onEvent: AdapterEventHandler,
    opts?: { force?: boolean; model?: string; modelParams?: ModelParam[] },
  ): Promise<AdapterRun>;
  dispose(): Promise<void>;
}

export interface Adapter {
  readonly id: string;
  readonly displayName: string;
  readonly description?: string;
  readonly capabilities: AdapterCapabilities;
  listModels(apiKey?: string, cwd?: string): Promise<ModelListResponse>;
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
  probe?(): Promise<void>;
  loginInteractive?(): Promise<void>;
  authStatus?(): Promise<{ loggedIn: boolean; email?: string }>;
  discover?(): Promise<AdapterDiscoverItem[]>;
  /** Process-level teardown (shared servers). Session dispose stays on AdapterSession. */
  shutdown?(): Promise<void>;
}
