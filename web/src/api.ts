import type {
  AdapterDiscoverItem,
  AdapterPublicInfo,
  ConfigPatch,
  MessageAttachment,
  ModelListResponse,
  RedactedConfig,
  ThreadSummary,
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
  threads: () => req<{ threads: ThreadSummary[]; currentId: string | null }>("/api/threads"),
  newThread: () => req<{ threads: ThreadSummary[]; currentId: string | null }>("/api/threads", { method: "POST" }),
  switchThread: (id: string) =>
    req<{ threads: ThreadSummary[]; currentId: string | null }>(`/api/threads/${encodeURIComponent(id)}/switch`, {
      method: "POST",
    }),
  deleteThread: (id: string) =>
    req<{ threads: ThreadSummary[]; currentId: string | null }>(`/api/threads/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  reachability: () =>
    req<{ bind: string; port: number; publicUrl: string; loopback: boolean }>("/api/reachability"),
  workspaces: (root?: string) =>
    req<{ recents: string[]; workspaces: { path: string; name: string }[] }>(
      root ? `/api/workspaces?root=${encodeURIComponent(root)}` : "/api/workspaces",
    ),
  upload: async (file: File) => {
    const token = getToken();
    const res = await fetch(`/api/uploads?name=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": file.type || "image/png",
      },
      credentials: "include",
      body: file,
    });
    const data = (await res.json().catch(() => ({}))) as MessageAttachment & { error?: string };
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data as MessageAttachment;
  },
  adapterStatus: (adapter: string) =>
    req<{
      loggedIn: boolean;
      email?: string;
      apiKeyConfigured: boolean;
      loginUrl?: string;
      loginStatus?: string;
      loginError?: string;
    }>(`/api/auth/adapter-status?adapter=${encodeURIComponent(adapter)}`),
  adapterLogin: (adapter: string) =>
    req<{ ok: boolean; url?: string }>("/api/auth/adapter-login", { method: "POST", body: JSON.stringify({ adapter }) }),
  adapterLoginCancel: () => req<{ ok: boolean }>("/api/auth/adapter-login/cancel", { method: "POST" }),
  restart: () => req<{ ok: boolean }>("/api/admin/restart", { method: "POST" }),
};
