import type {
  AdapterDiscoverItem,
  AdapterPublicInfo,
  ConfigPatch,
  ModelListResponse,
  RedactedConfig,
} from "@glassys/protocol";

const TOKEN_KEY = "glassys_token";

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(path, { ...init, headers, credentials: "include" });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export const api = {
  status: () => req<{ setupComplete: boolean; onboarded: boolean }>("/api/auth/status"),
  me: () => req<{ onboarded: boolean; setupComplete: boolean }>("/api/auth/me"),
  setup: (password: string) =>
    req<{ token: string }>("/api/auth/setup", { method: "POST", body: JSON.stringify({ password }) }),
  login: (password: string) =>
    req<{ token: string }>("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => req<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  config: () => req<RedactedConfig>("/api/config"),
  saveConfig: (patch: ConfigPatch) =>
    req<RedactedConfig>("/api/config", { method: "PUT", body: JSON.stringify(patch) }),
  models: (adapter?: string) =>
    req<ModelListResponse>(adapter ? `/api/models?adapter=${encodeURIComponent(adapter)}` : "/api/models"),
  adapters: () => req<{ adapters: AdapterPublicInfo[] }>("/api/adapters"),
  discover: (id: string) => req<{ agents: AdapterDiscoverItem[] }>(`/api/adapters/${id}/discover`),
  adapterStatus: (adapter: string) =>
    req<{ loggedIn: boolean; email?: string; apiKeyConfigured: boolean }>(
      `/api/auth/adapter-status?adapter=${encodeURIComponent(adapter)}`,
    ),
  adapterLogin: (adapter: string) =>
    req<{ ok: boolean }>("/api/auth/adapter-login", { method: "POST", body: JSON.stringify({ adapter }) }),
  restart: () => req<{ ok: boolean }>("/api/admin/restart", { method: "POST" }),
};
