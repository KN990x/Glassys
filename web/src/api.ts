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
    req<{
      bind: string;
      port: number;
      publicUrl: string;
      loopback: boolean;
      hostname?: string;
      user?: string;
      git?: { branch: string; dirty: boolean };
    }>("/api/reachability"),
  workspaces: (root?: string) =>
    req<{ recents: string[]; pins: string[]; workspaces: { path: string; name: string }[] }>(
      root ? `/api/workspaces?root=${encodeURIComponent(root)}` : "/api/workspaces",
    ),
  pinWorkspaces: (pins: string[]) => req<{ pins: string[] }>("/api/workspaces/pins", { method: "PUT", body: JSON.stringify({ pins }) }),
  openWorkspace: (cwd: string) =>
    req<{ threads: ThreadSummary[]; currentId: string | null; config: RedactedConfig }>("/api/workspaces/open", {
      method: "POST",
      body: JSON.stringify({ cwd }),
    }),
  usage: () =>
    req<{
      inputTokens: number;
      outputTokens: number;
      byAdapter: Record<string, { inputTokens: number; outputTokens: number }>;
      updatedAt: string;
    }>("/api/usage"),
  vapid: () => req<{ publicKey: string; subject: string }>("/api/push/vapid"),
  pushSubscribe: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    req<{ ok: boolean }>("/api/push/subscribe", { method: "POST", body: JSON.stringify(sub) }),
  pushUnsubscribe: (endpoint: string) =>
    req<{ ok: boolean }>("/api/push/subscribe", { method: "DELETE", body: JSON.stringify({ endpoint }) }),
  schedules: () =>
    req<{
      schedules: Array<{
        id: string;
        text: string;
        cwd: string;
        threadId?: string;
        cron?: string;
        at?: string;
        enabled: boolean;
        nextRun: string | null;
      }>;
    }>("/api/schedules"),
  createSchedule: (body: { text: string; cwd?: string; threadId?: string; cron?: string; at?: string; enabled?: boolean }) =>
    req<{ id: string; nextRun: string | null }>("/api/schedules", { method: "POST", body: JSON.stringify(body) }),
  patchSchedule: (id: string, body: Record<string, unknown>) =>
    req<{ id: string; nextRun: string | null }>(`/api/schedules/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteSchedule: (id: string) => req<{ ok: boolean }>(`/api/schedules/${encodeURIComponent(id)}`, { method: "DELETE" }),
  adminUpdate: () =>
    req<{
      version: string;
      protocolVersion: number;
      git?: { sha: string; branch: string; dirty: boolean };
      service: "launchd" | "systemd" | "none";
      upgrading?: { phase: string; error?: string };
    }>("/api/admin/update"),
  adminUpdateCheck: () =>
    req<{ behind: number; sha: string; branch: string; dirty: boolean }>("/api/admin/update/check", { method: "POST" }),
  upgrade: () => req<{ ok: boolean; upgrading: boolean }>("/api/admin/upgrade", { method: "POST" }),
  upload: async (file: File) => {
    const token = getToken();
    const res = await fetch(`/api/uploads?name=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": file.type || "application/octet-stream",
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
  renameThread: (id: string, title: string) =>
    req<{ threads: ThreadSummary[]; currentId: string | null }>(`/api/threads/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),
  exportThread: async (id: string) => {
    const headers = new Headers();
    const token = getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const res = await fetch(`/api/threads/${encodeURIComponent(id)}/export`, { headers, credentials: "include" });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || res.statusText);
    }
    const blob = await res.blob();
    const cd = res.headers.get("content-disposition") || "";
    const name = /filename="([^"]+)"/.exec(cd)?.[1] || "thread.md";
    return { blob, name };
  },
};
