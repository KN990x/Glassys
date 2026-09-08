import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import YAML from "yaml";
import {
  type ConfigPatch,
  type GlassysConfig,
  type AgentConfig,
  type RedactedConfig,
  clampKeepaliveSeconds,
  clampStallSeconds,
  defaultConfig,
  normalizePromptTemplates,
  optionString,
} from "@glassys/protocol";
import { paths } from "./paths.js";
import {
  adapterApiKey,
  adapterKeyFromEnv,
  hashPassword,
  loadSecrets,
  operatorPasswordError,
  patchSecrets,
  secretsFlags,
} from "./secrets.js";
import { stripOperatorRestricted } from "./config-patch.js";
import { HttpError } from "./errors.js";
import { probeAdapter, tryGetAdapter } from "./adapters.js";
import { createMutex } from "./lock.js";

const withConfigLock = createMutex();

function isObj(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function isUnsafeKey(key: string): boolean {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (!isObj(base) || !isObj(patch)) return (patch === undefined ? base : (patch as T));
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || isUnsafeKey(k)) continue;
    const prev = out[k];
    out[k] = isObj(prev) && isObj(v) ? deepMerge(prev, v) : v;
  }
  return out as T;
}

export function restartRequired(before: GlassysConfig, after: GlassysConfig): boolean {
  return before.network.bind !== after.network.bind || before.network.port !== after.network.port;
}

async function ensureConfigFile(): Promise<void> {
  await mkdir(paths.data(), { recursive: true });
  if (existsSync(paths.config())) return;
  await writeFile(paths.config(), YAML.stringify(defaultConfig()), "utf8");
}

function migrateLegacyAgent(parsed: unknown, agent: AgentConfig): { agent: AgentConfig; changed: boolean } {
  const rawAgent = isObj(parsed) && isObj(parsed.agent) ? parsed.agent : null;
  const options: Record<string, unknown> = { ...(agent.options ?? {}) };
  let changed = false;
  if (rawAgent) {
    if (Array.isArray(rawAgent.settingSources) && options.settingSources === undefined) {
      options.settingSources = rawAgent.settingSources;
      changed = true;
    }
    if (typeof rawAgent.sandbox === "boolean" && options.sandbox === undefined) {
      options.sandbox = rawAgent.sandbox;
      changed = true;
    }
    if (typeof rawAgent.autoRun === "boolean" && options.autoRun === undefined) {
      options.autoRun = rawAgent.autoRun;
      changed = true;
    }
  }
  const extra = agent as AgentConfig & { settingSources?: unknown; sandbox?: unknown; autoRun?: unknown };
  const next: AgentConfig = {
    adapter: agent.adapter || "cursor",
    cwd: agent.cwd || "",
    model: typeof agent.model === "string" ? agent.model : "",
    modelParams: Array.isArray(agent.modelParams) ? agent.modelParams : [],
    options,
  };
  if ("settingSources" in extra || "sandbox" in extra || "autoRun" in extra) changed = true;
  return { agent: next, changed };
}

function normalizeLoaded(cfg: GlassysConfig, parsed: unknown): { cfg: GlassysConfig; persist: boolean } {
  const migrated = migrateLegacyAgent(parsed, cfg.agent);
  cfg.agent = migrated.agent;
  const adapter = tryGetAdapter(cfg.agent.adapter);
  const before = JSON.stringify(cfg.agent);
  if (adapter?.normalizeConfig) cfg.agent = adapter.normalizeConfig(cfg.agent);
  const keepalive = clampKeepaliveSeconds(cfg.network.wsKeepaliveSeconds);
  const keepaliveChanged = keepalive !== cfg.network.wsKeepaliveSeconds;
  cfg.network.wsKeepaliveSeconds = keepalive;
  const stall = clampStallSeconds(cfg.session.stallSeconds);
  const stallChanged = stall !== cfg.session.stallSeconds;
  cfg.session.stallSeconds = stall;
  if (typeof cfg.session.notifyOnComplete !== "boolean") cfg.session.notifyOnComplete = true;
  const templates = Array.isArray(cfg.prompts?.templates)
    ? normalizePromptTemplates(cfg.prompts.templates)
    : defaultConfig().prompts.templates;
  const promptsChanged = JSON.stringify(cfg.prompts?.templates) !== JSON.stringify(templates);
  cfg.prompts = { templates };
  const persist =
    migrated.changed || before !== JSON.stringify(cfg.agent) || keepaliveChanged || stallChanged || promptsChanged;
  return { cfg, persist };
}

async function loadConfigUnlocked(): Promise<GlassysConfig> {
  await ensureConfigFile();
  const raw = await readFile(paths.config(), "utf8");
  const parsed = YAML.parse(raw) as unknown;
  const { cfg, persist } = normalizeLoaded(deepMerge(defaultConfig(), parsed), parsed);
  if (persist) await saveConfig(cfg);
  return cfg;
}

export async function loadConfig(): Promise<GlassysConfig> {
  return withConfigLock(loadConfigUnlocked);
}

export async function saveConfig(cfg: GlassysConfig): Promise<void> {
  await mkdir(dirname(paths.config()), { recursive: true });
  const tmp = `${paths.config()}.tmp`;
  const toWrite: GlassysConfig = {
    ...cfg,
    agent: {
      adapter: cfg.agent.adapter,
      cwd: cfg.agent.cwd,
      model: cfg.agent.model,
      modelParams: cfg.agent.modelParams,
      options: cfg.agent.options ?? {},
    },
  };
  await writeFile(tmp, YAML.stringify(toWrite), "utf8");
  await rename(tmp, paths.config());
}

export async function applyPatch(patch: ConfigPatch): Promise<{ config: GlassysConfig; restart: boolean }> {
  return withConfigLock(async () => {
    const before = await loadConfigUnlocked();
    const { cursorApiKey, operatorPassword, adapterApiKey: adapterKey, ...rest } = stripOperatorRestricted(patch);
    if (rest.agent !== undefined && !isObj(rest.agent)) {
      throw new HttpError(400, "agent must be an object");
    }
    if (rest.space !== undefined && !isObj(rest.space)) {
      throw new HttpError(400, "space must be an object");
    }
    const after = deepMerge(before, rest);
    const migrated = migrateLegacyAgent({ agent: after.agent }, after.agent);
    after.agent = migrated.agent;
    if (after.agent.adapter && !tryGetAdapter(after.agent.adapter)) {
      throw new HttpError(400, `Unknown adapter: ${after.agent.adapter}`);
    }
    const adapter = tryGetAdapter(after.agent.adapter);
    if (adapter?.normalizeConfig) after.agent = adapter.normalizeConfig(after.agent);
    after.network.wsKeepaliveSeconds = clampKeepaliveSeconds(after.network.wsKeepaliveSeconds);
    after.session.stallSeconds = clampStallSeconds(after.session.stallSeconds);
    if (typeof after.session.notifyOnComplete !== "boolean") after.session.notifyOnComplete = true;
    after.prompts = {
      templates: Array.isArray(after.prompts?.templates)
        ? normalizePromptTemplates(after.prompts.templates)
        : defaultConfig().prompts.templates,
    };
    const adapterChanging =
      isObj(rest.agent) && typeof rest.agent.adapter === "string" && rest.agent.adapter !== before.agent.adapter;
    const completing = rest.onboarding?.completed === true;
    if (adapter && (adapterChanging || completing || (adapter.id === "acp" && isObj(rest.agent)))) {
      const availability = await probeAdapter(adapter, after.agent.options);
      if (!availability.ok) throw new HttpError(400, availability.error);
    }
    if (typeof operatorPassword === "string" && operatorPassword.length > 0) {
      const passwordErr = operatorPasswordError(operatorPassword);
      if (passwordErr) throw new HttpError(400, passwordErr);
    }
    if (adapter?.id === "acp" && !optionString(after.agent.options, "command", "").trim()) {
      throw new HttpError(400, "ACP adapter needs agent.options.command (or a registry pick)");
    }
    await saveConfig(after);
    if (cursorApiKey !== undefined) {
      await patchSecrets({ adapterApiKey: { adapter: "cursor", value: typeof cursorApiKey === "string" ? cursorApiKey.trim() : "" } });
    }
    if (adapterKey) {
      await patchSecrets({
        adapterApiKey: { adapter: adapterKey.adapter, value: adapterKey.value?.trim() ?? "" },
      });
    }
    if (typeof operatorPassword === "string" && operatorPassword.length > 0) {
      const secrets = await loadSecrets();
      await patchSecrets({
        operatorPasswordHash: await hashPassword(operatorPassword),
        jwtEpoch: (secrets.jwtEpoch ?? 0) + 1,
        ...(process.env.GLASSYS_JWT_SECRET ? {} : { jwtSecret: randomBytes(32).toString("hex") }),
      });
    }
    return { config: after, restart: restartRequired(before, after) };
  });
}

export async function redacted(cfg?: GlassysConfig, restart?: boolean): Promise<RedactedConfig> {
  const config = cfg ?? (await loadConfig());
  const flags = secretsFlags(await loadSecrets());
  const adapters: Record<string, { apiKey: { configured: boolean; fromEnv?: boolean } }> = {};
  for (const [id, rec] of Object.entries(flags.adapters)) {
    adapters[id] = { apiKey: { configured: rec.apiKey, fromEnv: adapterKeyFromEnv(id) } };
  }
  const current = adapterApiKey(await loadSecrets(), config.agent.adapter);
  if (current && !adapters[config.agent.adapter]) {
    adapters[config.agent.adapter] = {
      apiKey: { configured: true, fromEnv: adapterKeyFromEnv(config.agent.adapter) },
    };
  }
  return {
    ...config,
    secrets: {
      operatorPassword: { configured: flags.operatorPassword },
      adapters,
      cursorApiKey: { configured: flags.cursorApiKey },
      vapidConfigured: flags.vapidConfigured,
    },
    restartRequired: restart,
  };
}

export function identityOptions(adapter: string, options: Record<string, unknown> | undefined): Record<string, unknown> {
  const o = options ?? {};
  switch (adapter) {
    case "cursor":
      return { settingSources: o.settingSources, sandbox: o.sandbox, autoRun: o.autoRun };
    case "claude":
      return { permissionMode: o.permissionMode, autoRun: o.autoRun };
    case "acp":
      return { command: o.command, args: o.args, registryId: o.registryId, autoRun: o.autoRun };
    default:
      return {};
  }
}

export function agentFingerprint(cfg: GlassysConfig): string {
  return JSON.stringify({
    cwd: cfg.agent.cwd,
    adapter: cfg.agent.adapter,
    options: identityOptions(cfg.agent.adapter, cfg.agent.options),
  });
}
