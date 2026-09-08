import type { AdapterPublicInfo } from "@glassys/protocol";

export function defaultOptionsFor(adapter: AdapterPublicInfo): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (adapter.capabilities.settingSources) o.settingSources = ["project", "user"];
  if (adapter.capabilities.sandbox) o.sandbox = false;
  if (adapter.capabilities.autoRun) o.autoRun = true;
  if (adapter.capabilities.toolConfirmation === "permission-mode") o.permissionMode = "bypassPermissions";
  if (adapter.capabilities.discover) {
    o.command = "";
    o.args = [];
    o.registryId = "";
  }
  return o;
}

/** Keep saved options when the adapter already matches config; otherwise adapter defaults. */
export function optionsForAdapter(
  adapter: AdapterPublicInfo,
  saved?: { adapter: string; options?: Record<string, unknown> },
): Record<string, unknown> {
  const defaults = defaultOptionsFor(adapter);
  if (saved?.adapter === adapter.id) return { ...defaults, ...(saved.options ?? {}) };
  return defaults;
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

export function setOption(
  options: Record<string, unknown> | undefined,
  key: string,
  value: unknown,
): Record<string, unknown> {
  return { ...(options ?? {}), [key]: value };
}

export function adapterKeyConfigured(
  secrets: { adapters?: Record<string, { apiKey?: { configured?: boolean } }>; cursorApiKey?: { configured?: boolean } },
  adapterId: string,
): boolean {
  if (secrets.adapters?.[adapterId]?.apiKey?.configured) return true;
  return adapterId === "cursor" && Boolean(secrets.cursorApiKey?.configured);
}
