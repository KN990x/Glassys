/**
 * What the PWA reads about the adapters: their model catalogues, availability, sign-in state and
 * discovery. None of it touches the run queue or the live session, so it lives outside the
 * runtime.
 */
import type { AdapterAuthStatus, AdapterDiscoverItem, AdapterPublicInfo, ModelListResponse } from "@glassys/protocol";
import { cancelLoginJob, snapshotLoginJob, startLoginJob } from "./adapter-login.js";
import { getAdapter, listAdapters, probeAdapter } from "./adapters.js";
import { loadConfig } from "./config.js";
import { log, paths } from "./paths.js";
import { adapterApiKey, loadSecrets, secretsFlags } from "./secrets.js";

export async function listModels(adapterId?: string): Promise<ModelListResponse> {
  const cfg = await loadConfig();
  const id = adapterId || cfg.agent.adapter;
  const adapter = getAdapter(id);
  const secrets = await loadSecrets();
  const key = adapterApiKey(secrets, id);
  const ctx = id === cfg.agent.adapter ? { options: cfg.agent.options, storeDir: paths.adapterStore(id) } : undefined;
  const result = await adapter.listModels(key || undefined, cfg.agent.cwd || undefined, ctx);
  const ids = result.models.map((m) => m.id);
  if (result.source === "fallback") {
    log("warn", "model catalog fallback", { adapter: id, error: result.error, count: ids.length, ids });
  } else {
    log("info", "model catalog live", { adapter: id, count: ids.length, ids });
  }
  return result;
}

const ADAPTER_INFO_TTL_MS = 30_000;
let adapterInfoCache: { at: number; value: AdapterPublicInfo[] } | null = null;

export function invalidateAdapterInfoCache(): void {
  adapterInfoCache = null;
}

export async function listAdapterInfo(): Promise<AdapterPublicInfo[]> {
  if (adapterInfoCache && Date.now() - adapterInfoCache.at < ADAPTER_INFO_TTL_MS) {
    return adapterInfoCache.value;
  }
  const secrets = await loadSecrets();
  const flags = secretsFlags(secrets);
  const cfg = await loadConfig();
  const out = await Promise.all(
    listAdapters().map(async (adapter) => {
      let status: { loggedIn: boolean; email?: string } = { loggedIn: false };
      try {
        status = adapter.authStatus ? await adapter.authStatus() : { loggedIn: false };
      } catch (err) {
        log("warn", "adapter authStatus failed", { adapter: adapter.id, error: String(err) });
      }
      const probeOpts = adapter.id === cfg.agent.adapter ? cfg.agent.options : undefined;
      return {
        id: adapter.id,
        displayName: adapter.displayName,
        description: adapter.description,
        capabilities: adapter.capabilities,
        available: await probeAdapter(adapter, probeOpts),
        auth: {
          loggedIn: status.loggedIn,
          email: status.email,
          apiKeyConfigured: Boolean(flags.adapters[adapter.id]?.apiKey || adapterApiKey(secrets, adapter.id)),
        },
      } satisfies AdapterPublicInfo;
    }),
  );
  adapterInfoCache = { at: Date.now(), value: out };
  return out;
}

export async function adapterLogin(adapterId: string): Promise<{ url?: string }> {
  const adapter = getAdapter(adapterId);
  if (!adapter.loginInteractive) throw new Error("Interactive login is not available for this adapter");
  invalidateAdapterInfoCache();
  return startLoginJob(adapterId, (opts) => adapter.loginInteractive!(opts));
}

export async function adapterLoginCancel(): Promise<void> {
  await cancelLoginJob();
}

export async function adapterAuthStatus(adapterId: string): Promise<AdapterAuthStatus> {
  const adapter = getAdapter(adapterId);
  const secrets = await loadSecrets();
  let status: { loggedIn: boolean; email?: string } = { loggedIn: false };
  try {
    status = adapter.authStatus ? await adapter.authStatus() : { loggedIn: false };
  } catch (err) {
    log("warn", "adapter authStatus failed", { adapter: adapterId, error: String(err) });
  }
  const login = snapshotLoginJob(adapterId);
  if (status.loggedIn) invalidateAdapterInfoCache();
  return {
    loggedIn: status.loggedIn,
    email: status.email,
    apiKeyConfigured: adapterApiKey(secrets, adapterId).length > 0,
    ...(login.status !== "idle" && login.url ? { loginUrl: login.url } : {}),
    ...(login.status !== "idle" ? { loginStatus: login.status } : {}),
    ...(login.error ? { loginError: login.error } : {}),
  };
}

export async function discoverAdapter(adapterId: string): Promise<AdapterDiscoverItem[]> {
  const adapter = getAdapter(adapterId);
  if (!adapter.discover) return [];
  return adapter.discover();
}
