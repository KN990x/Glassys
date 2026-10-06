import { optionBool, optionString, optionStringArray, type AdapterCapabilities, type AdapterPublicInfo } from "@glassys/protocol";

export { optionBool, optionString, optionStringArray };

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

export function setOption(
  options: Record<string, unknown> | undefined,
  key: string,
  value: unknown,
): Record<string, unknown> {
  return { ...(options ?? {}), [key]: value };
}

/** Keep Claude permissionMode in lockstep with the auto-run checkbox. */
export function setAutoRun(
  options: Record<string, unknown> | undefined,
  autoRun: boolean,
  toolConfirmation?: string,
): Record<string, unknown> {
  let next = setOption(options, "autoRun", autoRun);
  if (toolConfirmation !== "permission-mode") return next;
  const mode = optionString(next, "permissionMode", autoRun ? "bypassPermissions" : "dontAsk");
  if (autoRun && mode !== "bypassPermissions") next = setOption(next, "permissionMode", "bypassPermissions");
  if (!autoRun && mode === "bypassPermissions") next = setOption(next, "permissionMode", "dontAsk");
  return next;
}

export function setPermissionMode(
  options: Record<string, unknown> | undefined,
  mode: string,
): Record<string, unknown> {
  const next = setOption(options, "permissionMode", mode);
  return setOption(next, "autoRun", mode === "bypassPermissions");
}

export function archivesLiveThread(
  before: { adapter: string; cwd: string; options?: Record<string, unknown> },
  after: { adapter: string; cwd: string; options?: Record<string, unknown> },
): boolean {
  return (
    before.adapter !== after.adapter ||
    before.cwd !== after.cwd ||
    JSON.stringify(before.options ?? {}) !== JSON.stringify(after.options ?? {})
  );
}

export function adapterKeyConfigured(
  secrets: { adapters?: Record<string, { apiKey?: { configured?: boolean } }>; cursorApiKey?: { configured?: boolean } },
  adapterId: string,
): boolean {
  if (secrets.adapters?.[adapterId]?.apiKey?.configured) return true;
  return adapterId === "cursor" && Boolean(secrets.cursorApiKey?.configured);
}

/**
 * True when the agent's cwd contains the Glassys data dir and nothing sandboxes the agent: a
 * shell can then read the operator's secrets. Glassys blocks the plain paths where it mediates
 * tools; only the sandbox actually stops a shell.
 */
export function cwdExposesDataDir(input: { cwd: string; dataDir?: string; sandbox: boolean; sandboxSupported: boolean }): boolean {
  if (!input.dataDir || !input.cwd) return false;
  if (input.sandboxSupported && input.sandbox) return false;
  const trim = (p: string) => (p.length > 1 ? p.replace(/[\\/]+$/, "") : p);
  const cwd = trim(input.cwd);
  const data = trim(input.dataDir);
  if (cwd === "/" || cwd === data) return true;
  const sepChar = data.includes("\\") && !data.includes("/") ? "\\" : "/";
  return data.startsWith(cwd + sepChar) || cwd.startsWith(data + sepChar);
}

/**
 * Whether the agent runs sandboxed, for the risk glyph: a plain on/off sandbox, or an adapter
 * sandbox level short of full access. A level left to the adapter's own config is unknown here,
 * so it does not count as sandboxed.
 */
export function sandboxState(
  caps: Pick<AdapterCapabilities, "sandbox" | "sandboxModes"> | undefined,
  options: Record<string, unknown> | undefined,
): { supported: boolean; on: boolean } {
  if (caps?.sandboxModes?.length) {
    const mode = optionString(options, "sandboxMode", "");
    return { supported: true, on: mode !== "" && mode !== "danger-full-access" && caps.sandboxModes.includes(mode) };
  }
  if (caps?.sandbox) return { supported: true, on: optionBool(options, "sandbox", false) };
  return { supported: false, on: false };
}
