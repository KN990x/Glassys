export const PROTOCOL_VERSION = 1;
export const DEFAULT_BIND = "127.0.0.1";
export const DEFAULT_PORT = 8787;
export const DEFAULT_KEEPALIVE_SECONDS = 25;
export const MIN_KEEPALIVE_SECONDS = 15;
export const MAX_KEEPALIVE_SECONDS = 30;
export const PROFILE_ID = "default";
export const DEFAULT_STALL_SECONDS = 180;
export const MAX_STALL_SECONDS = 3600;
export const MAX_PINNED_CWDS = 12;
export const MAX_ATTACHMENTS = 4;

export function clampKeepaliveSeconds(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_KEEPALIVE_SECONDS;
  return Math.min(MAX_KEEPALIVE_SECONDS, Math.max(MIN_KEEPALIVE_SECONDS, Math.round(value)));
}

/** 0 disables the run stall watchdog. */
export function clampStallSeconds(value: number): number {
  if (!Number.isFinite(value) || value < 0) return DEFAULT_STALL_SECONDS;
  return Math.min(MAX_STALL_SECONDS, Math.round(value));
}

export function isTheme(value: unknown): value is Theme {
  return value === "dark" || value === "light" || value === "system";
}

export function resolveTheme(theme: Theme, prefersLight?: boolean): ResolvedTheme {
  if (theme === "light" || theme === "dark") return theme;
  if (prefersLight === true) return "light";
  if (prefersLight === false) return "dark";
  const matchMedia = (globalThis as { matchMedia?: (query: string) => { matches: boolean } }).matchMedia;
  if (typeof matchMedia === "function") {
    try {
      if (matchMedia("(prefers-color-scheme: light)").matches) return "light";
    } catch {
      /* ignore */
    }
  }
  return "dark";
}

export {
  defaultParamsFor,
  pickDefaultSelection,
  matchingVariant,
  mergeModelCatalog,
  normalizeCatalogItem,
  labelFromParams,
  variantOptionLabel,
  modelOptionLabel,
  variantsHaveUsefulNames,
} from "./models.js";
export type {
  ModelParam,
  ModelParamDef,
  ModelParamValue,
  ModelVariant,
  ModelCatalogItem,
  ModelListSource,
  ModelListResponse,
} from "./models.js";

import type { ModelParam } from "./models.js";

export type ToolKind =
  | "read"
  | "write"
  | "edit"
  | "grep"
  | "glob"
  | "ls"
  | "semsearch"
  | "shell"
  | "mcp"
  | "task"
  | "other";

export type Theme = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";
export type ThinkingDefault = "collapsed" | "expanded";
export type EdgeAuth = "none" | "cloudflare-access" | "header";
export type SettingSource = "project" | "user" | "plugins" | "team" | "mdm" | "all";

export type AdapterAuthKind = "sdk-login" | "api-key" | "cli-binary";
export type ToolConfirmation = "auto-review-deny" | "permission-mode" | "none";

export interface AdapterAuthCapability {
  kind: AdapterAuthKind;
  envNames: string[];
}

export interface AdapterCapabilities {
  models: boolean;
  sandbox: boolean;
  settingSources: boolean;
  autoRun: boolean;
  cancel: boolean;
  resume: boolean;
  /** Adapter can list ACP-style registry agents via GET /api/adapters/:id/discover. */
  discover: boolean;
  toolConfirmation: ToolConfirmation;
  auth: AdapterAuthCapability;
  /** When false, a static catalog is expected; the PWA must not treat source:fallback as a failure. Default true. */
  liveCatalog?: boolean;
  /** Adapter can pass image parts natively. Missing/false still allows path-note fallback. */
  attachments?: boolean;
  defaultModel?: { id: string; params: ModelParam[] };
}

export type AdapterAvailability = { ok: true } | { ok: false; error: string };

export interface AdapterPublicInfo {
  id: string;
  displayName: string;
  description?: string;
  capabilities: AdapterCapabilities;
  /** Omitted by older gateways; treat missing as selectable. */
  available?: AdapterAvailability;
  auth: {
    loggedIn: boolean;
    email?: string;
    apiKeyConfigured: boolean;
  };
}

export function adapterSelectable(info: AdapterPublicInfo): boolean {
  return info.available?.ok !== false;
}

export interface AdapterDiscoverItem {
  id: string;
  displayName: string;
  description?: string;
  command?: string;
  args?: string[];
}

export interface SpaceConfig {
  name: string;
  locale: string;
  theme: Theme;
}

export interface AgentConfig {
  adapter: string;
  cwd: string;
  model: string;
  modelParams: ModelParam[];
  /** Adapter-specific. Cursor: settingSources, sandbox, autoRun. Claude: permissionMode. ACP: command, args, registryId. */
  options: Record<string, unknown>;
}

export interface NetworkConfig {
  bind: string;
  port: number;
  publicUrl: string;
  allowedOrigins: string[];
  wsKeepaliveSeconds: number;
}

export interface SecurityConfig {
  edgeAuth: EdgeAuth;
  cloudflare: {
    teamDomain: string;
    audience: string;
  };
  identityHeader: string;
  sessionTtlHours: number;
}

export interface DisplayConfig {
  thinkingDefault: ThinkingDefault;
  diffPreview: boolean;
  shellLinesVisible: number;
}

export interface SessionConfig {
  resumeOnStart: boolean;
  queue: "fifo";
  /** Seconds of no run events before `run.stalled`. 0 = off. */
  stallSeconds: number;
  /** Web Push / notification when a run finishes, errors, stalls, or a tool is denied. */
  notifyOnComplete: boolean;
}

export interface PromptTemplate {
  id: string;
  slash: string;
  title: string;
  text: string;
}

export interface PromptsConfig {
  templates: PromptTemplate[];
}

export interface ThreadUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface GlassysConfig {
  space: SpaceConfig;
  onboarding: { completed: boolean };
  agent: AgentConfig;
  network: NetworkConfig;
  security: SecurityConfig;
  display: DisplayConfig;
  session: SessionConfig;
  prompts: PromptsConfig;
}

export interface SecretFlags {
  operatorPassword: { configured: boolean };
  adapters: Record<string, { apiKey: { configured: boolean; fromEnv?: boolean } }>;
  /** @deprecated Use adapters.cursor. Kept so older clients still type-check. */
  cursorApiKey: { configured: boolean };
  vapidConfigured?: boolean;
}

export interface RedactedConfig extends GlassysConfig {
  secrets: SecretFlags;
  restartRequired?: boolean;
}

export type ConfigPatch = {
  space?: Partial<SpaceConfig>;
  onboarding?: { completed?: boolean };
  agent?: Partial<AgentConfig>;
  network?: Partial<NetworkConfig>;
  security?: Partial<SecurityConfig> & {
    cloudflare?: Partial<SecurityConfig["cloudflare"]>;
  };
  display?: Partial<DisplayConfig>;
  session?: Partial<SessionConfig>;
  prompts?: Partial<PromptsConfig>;
  /** Writes secrets.adapters[adapter]. Empty/null clears. */
  adapterApiKey?: { adapter: string; value: string | null };
  /** @deprecated Writes secrets.adapters.cursor */
  cursorApiKey?: string | null;
  operatorPassword?: string;
};

export interface MessageAttachment {
  id: string;
  mime: string;
  name: string;
}

export interface QueueItem {
  id: string;
  text: string;
  hasAttachments?: boolean;
  source?: "user" | "schedule";
}

export interface ThreadSummary {
  id: string;
  title: string;
  adapter: string;
  cwd: string;
  updatedAt: string;
  usage?: ThreadUsage;
}

export type ClientMessage =
  | { type: "hello"; protocolVersion: number }
  | { type: "auth"; token: string }
  | { type: "user.message"; text: string; id?: string; attachments?: MessageAttachment[] }
  | { type: "run.cancel" }
  | { type: "queue.cancel"; id: string }
  | { type: "thread.new" }
  | { type: "thread.switch"; id: string }
  | { type: "config.get" }
  | { type: "config.set"; patch: ConfigPatch }
  | { type: "ping"; ts?: number };

export interface ToolStart {
  type: "tool.start";
  callId: string;
  kind: ToolKind;
  title: string;
  path?: string;
  command?: string;
}

export interface ToolProgress {
  type: "tool.progress";
  callId: string;
  chunk?: string;
}

export interface ToolEnd {
  type: "tool.end";
  callId: string;
  ok: boolean;
  kind: ToolKind;
  diff?: string;
  stats?: { add: number; del: number };
  outputPreview?: string;
  error?: string;
  truncated?: boolean;
  denied?: boolean;
}

export type TranscriptEvent =
  | { type: "user.message"; text: string; id?: string; attachments?: MessageAttachment[] }
  | { type: "user.retracted"; id: string }
  | { type: "thinking.delta"; text: string }
  | { type: "thinking.done"; durationMs: number }
  | { type: "text.delta"; text: string }
  | ToolStart
  | ToolProgress
  | ToolEnd
  | { type: "run.queued" }
  | { type: "run.start"; runId?: string }
  | { type: "run.done" }
  | { type: "run.error"; message: string; phase?: "startup" | "run" }
  | { type: "run.cancelled" }
  | { type: "run.stalled"; idleMs: number }
  | { type: "run.usage"; inputTokens?: number; outputTokens?: number };

export type ServerMessage =
  | { type: "hello.ok"; protocolVersion: number }
  | { type: "hello.incompatible"; protocolVersion: number }
  | { type: "auth.ok" }
  | { type: "auth.error"; message: string }
  | { type: "pong"; ts?: number }
  | {
      type: "session";
      profileId: string;
      agentId: string | null;
      busy: boolean;
      threadId?: string;
      runStartedAt?: number;
    }
  | { type: "queue.snapshot"; items: QueueItem[] }
  | { type: "threads.snapshot"; threads: ThreadSummary[]; currentId: string | null }
  | { type: "config"; config: RedactedConfig }
  | { type: "config.error"; message: string }
  | { type: "transcript.snapshot"; events: TranscriptEvent[]; truncated?: boolean }
  | TranscriptEvent;

export function isClientMessage(value: unknown): value is ClientMessage {
  if (!value || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  switch (rec.type) {
    case "hello":
      return typeof rec.protocolVersion === "number";
    case "auth":
      return typeof rec.token === "string";
    case "user.message":
      return typeof rec.text === "string" && optionalAttachments(rec.attachments);
    case "queue.cancel":
    case "thread.switch":
      return typeof rec.id === "string";
    case "thread.new":
    case "run.cancel":
    case "config.get":
      return true;
    case "config.set":
      return Boolean(rec.patch) && typeof rec.patch === "object" && !Array.isArray(rec.patch);
    case "ping":
      return rec.ts === undefined || typeof rec.ts === "number";
    default:
      return false;
  }
}

export function defaultAgentOptions(): Record<string, unknown> {
  return {};
}

export function normalizePromptTemplates(templates: unknown): PromptTemplate[] {
  if (!Array.isArray(templates)) return defaultPromptTemplates();
  const seen = new Set<string>();
  const out: PromptTemplate[] = [];
  for (const raw of templates) {
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as Record<string, unknown>;
    const slash = String(rec.slash || "")
      .replace(/^\//, "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
    const text = String(rec.text || "").trim();
    if (!slash || !text || seen.has(slash)) continue;
    seen.add(slash);
    const id = (String(rec.id || slash).trim() || slash).slice(0, 40);
    const title = (String(rec.title || slash).trim() || slash).slice(0, 80);
    out.push({ id, slash, title, text });
  }
  return out;
}

export function defaultPromptTemplates(): PromptTemplate[] {
  return [
    {
      id: "status",
      slash: "status",
      title: "Host status",
      text: "Check systemd/launchd failed units, disk usage, and memory. Summarize what needs attention.",
    },
    {
      id: "disk",
      slash: "disk",
      title: "Disk usage",
      text: "Report filesystem usage and large directories that look abnormal.",
    },
    {
      id: "failed-units",
      slash: "failed-units",
      title: "Failed units",
      text: "List failed or degraded services and recent journal errors.",
    },
  ];
}

export function defaultConfig(): GlassysConfig {
  return {
    space: { name: "Glassys", locale: "en", theme: "dark" },
    onboarding: { completed: false },
    agent: {
      adapter: "cursor",
      cwd: "",
      model: "",
      modelParams: [],
      options: defaultAgentOptions(),
    },
    network: {
      bind: DEFAULT_BIND,
      port: DEFAULT_PORT,
      publicUrl: "",
      allowedOrigins: [],
      wsKeepaliveSeconds: DEFAULT_KEEPALIVE_SECONDS,
    },
    security: {
      edgeAuth: "none",
      cloudflare: { teamDomain: "", audience: "" },
      identityHeader: "",
      sessionTtlHours: 168,
    },
    display: {
      thinkingDefault: "collapsed",
      diffPreview: true,
      shellLinesVisible: 12,
    },
    session: {
      resumeOnStart: true,
      queue: "fifo",
      stallSeconds: DEFAULT_STALL_SECONDS,
      notifyOnComplete: true,
    },
    prompts: { templates: defaultPromptTemplates() },
  };
}

export function isTranscriptEvent(value: ServerMessage): value is TranscriptEvent {
  return (
    value.type.startsWith("user.") ||
    value.type.startsWith("thinking.") ||
    value.type.startsWith("text.") ||
    value.type.startsWith("tool.") ||
    value.type.startsWith("run.")
  );
}

/** Live UI events that must not be replayed from transcript.jsonl. */
export function isPersistedTranscriptEvent(value: ServerMessage): value is TranscriptEvent {
  return (
    isTranscriptEvent(value) &&
    value.type !== "run.queued" &&
    value.type !== "run.start" &&
    value.type !== "tool.progress"
  );
}

const MESSAGE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Client-supplied `user.message.id` must be a UUID so the gateway can honor it. */
export function isMessageId(value: unknown): value is string {
  return typeof value === "string" && MESSAGE_ID_RE.test(value);
}

export function optionBool(options: Record<string, unknown> | undefined, key: string, fallback: boolean): boolean {
  const v = options?.[key];
  return typeof v === "boolean" ? v : fallback;
}

export function optionString(options: Record<string, unknown> | undefined, key: string, fallback = ""): string {
  const v = options?.[key];
  return typeof v === "string" ? v : fallback;
}

export function optionStringArray(
  options: Record<string, unknown> | undefined,
  key: string,
  fallback: string[] = [],
): string[] {
  const v = options?.[key];
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : fallback;
}

export function optionRecord(options: Record<string, unknown> | undefined): Record<string, unknown> {
  return options && typeof options === "object" ? options : {};
}

export function isMessageAttachment(value: unknown): value is MessageAttachment {
  if (!value || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  return typeof rec.id === "string" && typeof rec.mime === "string" && typeof rec.name === "string";
}

function optionalAttachments(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every(isMessageAttachment));
}
