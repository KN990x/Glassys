import { useEffect, useRef, useState } from "react";
import type {
  AdapterDiscoverItem,
  AdapterPublicInfo,
  ModelCatalogItem,
  ModelListSource,
  PromptTemplate,
  RedactedConfig,
  SettingSource,
} from "@glassys/protocol";
import { pickDefaultSelection, adapterSelectable, isTheme } from "@glassys/protocol";
import { api, clearToken } from "../api";
import { useT } from "../i18n";
import { ModelPicker, paramsForSelection } from "../components/ModelPicker";
import { CatalogFallbackNotice } from "../components/CatalogFallback";
import { SdkLoginControls } from "../components/SdkLogin";
import { WorkspacePicker } from "../components/WorkspacePicker";
import { ReachabilityCard } from "../components/Reachability";
import { defaultOptionsFor, optionBool, optionString, optionStringArray, setOption, setAutoRun, setPermissionMode, archivesLiveThread } from "../adapterOptions";
import { operatorError } from "../operatorError";
import { enableWebPush, disableWebPush } from "../push";

export function Settings({
  config,
  onClose,
  onConfig,
  onLogout,
  currentThreadId,
  focusSection,
  schedulePrefill,
}: {
  config: RedactedConfig;
  onClose: () => void;
  onConfig: (c: RedactedConfig) => void;
  onLogout: () => void;
  currentThreadId?: string | null;
  focusSection?: "schedules" | "updates";
  schedulePrefill?: string;
}) {
  const t = useT();
  const [draft, setDraft] = useState(config);
  const [password, setPassword] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const [restartNote, setRestartNote] = useState("");
  const [models, setModels] = useState<ModelCatalogItem[]>([]);
  const [modelSource, setModelSource] = useState<ModelListSource>("live");
  const [modelError, setModelError] = useState("");
  const [adapters, setAdapters] = useState<AdapterPublicInfo[]>([]);
  const [adaptersError, setAdaptersError] = useState("");
  const [auth, setAuth] = useState<{ loggedIn: boolean; email?: string; apiKeyConfigured: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [discover, setDiscover] = useState<AdapterDiscoverItem[]>([]);
  const [usage, setUsage] = useState<{
    inputTokens: number;
    outputTokens: number;
    byAdapter: Record<string, { inputTokens: number; outputTokens: number }>;
  } | null>(null);
  const [threadUsage, setThreadUsage] = useState<{ inputTokens: number; outputTokens: number } | null>(null);
  const [schedules, setSchedules] = useState<
    Array<{
      id: string;
      text: string;
      cwd: string;
      threadId?: string;
      cron?: string;
      at?: string;
      enabled: boolean;
      nextRun: string | null;
      lastRun?: string;
      lastError?: string;
    }>
  >([]);
  const [scheduleTz, setScheduleTz] = useState("");
  const [scheduleText, setScheduleText] = useState("");
  const [scheduleCron, setScheduleCron] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");
  const [update, setUpdate] = useState<{
    version: string;
    protocolVersion: number;
    git?: { sha: string; branch: string; dirty: boolean };
    service: "launchd" | "systemd" | "none";
    upgrading?: { phase: string; error?: string };
  } | null>(null);
  const [behind, setBehind] = useState<number | null>(null);
  const [notifyNote, setNotifyNote] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const dirty =
    Boolean(password || apiKey || clearKey) ||
    JSON.stringify({
      space: draft.space,
      agent: draft.agent,
      display: draft.display,
      session: draft.session,
      prompts: draft.prompts,
    }) !==
      JSON.stringify({
        space: config.space,
        agent: config.agent,
        display: config.display,
        session: config.session,
        prompts: config.prompts,
      });

  function requestClose() {
    if (dirty && !window.confirm(t("settings.discard"))) return;
    onCloseRef.current();
  }
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  const currentAdapter = adapters.find((a) => a.id === draft.agent.adapter) ?? adapters[0];
  const caps = currentAdapter?.capabilities;

  useEffect(() => {
    setDraft(config);
  }, [config]);

  useEffect(() => {
    if (schedulePrefill) setScheduleText(schedulePrefill);
  }, [schedulePrefill]);

  useEffect(() => {
    if (!focusSection) return;
    const id = focusSection === "schedules" ? "settings-schedules" : "settings-updates";
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [focusSection]);

  useEffect(() => {
    closeRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const root = document.querySelector(".settings-dialog");
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        requestCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !root) return;
      const nodes = [...root.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )].filter((el) => !el.hasAttribute("disabled"));
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  async function loadModels(adapterId: string): Promise<ModelCatalogItem[]> {
    try {
      const r = await api.models(adapterId);
      setModels(r.models);
      setModelSource(r.source);
      setModelError(r.error || "");
      return r.models;
    } catch (err) {
      setModels([]);
      setModelSource("fallback");
      setModelError(err instanceof Error ? err.message : String(err));
      return [];
    }
  }

  useEffect(() => {
    api
      .adapters()
      .then((r) => {
        setAdapters(r.adapters);
        setAdaptersError(r.adapters.length ? "" : t("wizard.adapters.empty"));
      })
      .catch(() => {
        setAdapters([]);
        setAdaptersError(t("wizard.adapters.failed"));
      });
  }, [t]);

  useEffect(() => {
    api
      .usage()
      .then(setUsage)
      .catch(() => setUsage(null));
    api
      .threads()
      .then((r) => {
        const th = r.threads.find((item) => item.id === r.currentId);
        setThreadUsage(th?.usage ?? null);
      })
      .catch(() => setThreadUsage(null));
    api
      .schedules()
      .then((r) => {
        setSchedules(r.schedules);
        setScheduleTz(r.timezone || "");
      })
      .catch(() => setSchedules([]));
    api
      .adminUpdate()
      .then(setUpdate)
      .catch(() => setUpdate(null));
  }, []);

  useEffect(() => {
    const phase = update?.upgrading?.phase;
    if (!phase || phase === "idle" || phase === "error") return;
    const timer = setInterval(() => {
      void api.adminUpdate().then(setUpdate).catch(() => undefined);
      void fetch("/health").catch(() => undefined);
    }, 2500);
    return () => clearInterval(timer);
  }, [update?.upgrading?.phase]);

  useEffect(() => {
    let cancelled = false;
    setModels([]);
    setModelSource("live");
    setModelError("");
    void (async () => {
      const listed = await loadModels(draft.agent.adapter);
      if (cancelled) return;
      api.adapterStatus(draft.agent.adapter).then(setAuth).catch(() => setAuth(null));
      const adapter = adapters.find((a) => a.id === draft.agent.adapter);
      if (adapter?.capabilities.discover) {
        api.discover(adapter.id).then((r) => setDiscover(r.agents)).catch(() => setDiscover([]));
      } else setDiscover([]);
      const def = adapter?.capabilities.defaultModel;
      setDraft((d) => {
        if (d.agent.adapter !== draft.agent.adapter) return d;
        if (!listed.length) return d;
        if (listed.some((m) => m.id === d.agent.model)) return d;
        const sel = pickDefaultSelection(listed, def?.id);
        const item = listed.find((m) => m.id === (def?.id || sel.id));
        return {
          ...d,
          agent: {
            ...d.agent,
            model: def?.id || sel.id,
            modelParams: paramsForSelection(item, def),
          },
        };
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [draft.agent.adapter, adapters]);

  async function save() {
    if (submitting) return;
    setError("");
    if (!draft.agent.cwd.trim()) {
      setError(t("wizard.workspace.required"));
      return;
    }
    const selected = adapters.find((a) => a.id === draft.agent.adapter);
    if (selected && !adapterSelectable(selected) && selected.id !== config.agent.adapter) {
      setError(t("wizard.adapter.unavailable"));
      return;
    }
    if (draft.agent.adapter === "acp" && !optionString(draft.agent.options, "command", "").trim()) {
      setError(t("wizard.acp.commandRequired"));
      return;
    }
    if (archivesLiveThread(config.agent, draft.agent) && !window.confirm(t("settings.archiveConfirm"))) {
      return;
    }
    if (password && password.length < 8) {
      setError(t("setup.short"));
      return;
    }
    if (password && password.length > 256) {
      setError(t("setup.long"));
      return;
    }
    setSubmitting(true);
    try {
      const next = await api.saveConfig({
        space: { name: draft.space.name, locale: draft.space.locale, theme: draft.space.theme },
        agent: draft.agent,
        display: {
          ...draft.display,
          shellLinesVisible: Math.max(1, Math.floor(Number(draft.display.shellLinesVisible) || 12)),
        },
        session: draft.session,
        prompts: { templates: draft.prompts?.templates ?? [] },
        adapterApiKey: apiKey
          ? { adapter: draft.agent.adapter, value: apiKey }
          : clearKey
            ? { adapter: draft.agent.adapter, value: null }
            : undefined,
        operatorPassword: password || undefined,
      });
      onConfig(next);
      setDraft(next);
      setApiKey("");
      setClearKey(false);
      const rotatedPassword = Boolean(password);
      setPassword("");
      setSaved(t("settings.saved"));
      await loadModels(next.agent.adapter);
      setAuth(await api.adapterStatus(next.agent.adapter).catch(() => null));
      if (rotatedPassword) {
        clearToken();
        onLogout();
      }
    } catch (err) {
      setError(operatorError(err instanceof Error ? err.message : String(err), t));
    } finally {
      setSubmitting(false);
    }
  }

  function pickAdapter(id: string) {
    const next = adapters.find((a) => a.id === id);
    if (!next || !adapterSelectable(next)) return;
    const def = next.capabilities.defaultModel;
    setModels([]);
    setModelSource("live");
    setModelError("");
    setDraft({
      ...draft,
      agent: {
        ...draft.agent,
        adapter: id,
        model: def?.id || "",
        modelParams: def?.params ?? [],
        options: defaultOptionsFor(next),
      },
    });
  }

  function toggleSource(s: SettingSource, on: boolean) {
    const cur = optionStringArray(draft.agent.options, "settingSources", ["project", "user"]);
    setDraft({
      ...draft,
      agent: {
        ...draft.agent,
        options: setOption(draft.agent.options, "settingSources", on ? [...cur, s] : cur.filter((x) => x !== s)),
      },
    });
  }

  const templates = draft.prompts?.templates ?? [];

  function setTemplates(next: PromptTemplate[]) {
    setDraft({ ...draft, prompts: { templates: next } });
  }

  async function refreshSchedules() {
    try {
      const r = await api.schedules();
      setSchedules(r.schedules);
      setScheduleTz(r.timezone || "");
    } catch {
      /* ignore */
    }
  }

  async function enableNotify(on: boolean) {
    setNotifyNote("");
    try {
      if (on) {
        if (!window.isSecureContext) {
          setNotifyNote(t("settings.notifyHint"));
          return;
        }
        if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
          setNotifyNote(t("settings.notifyNeedSw"));
          return;
        }
        const { publicKey } = await api.vapid();
        const sub = await enableWebPush(publicKey);
        await api.pushSubscribe(sub);
      } else {
        const endpoint = await disableWebPush();
        if (endpoint) await api.pushUnsubscribe(endpoint);
      }
      const next = await api.saveConfig({ session: { notifyOnComplete: on } });
      setDraft(next);
      onConfig(next);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setNotifyNote(msg.includes("denied") || msg.includes("permission") ? t("settings.notifyDenied") : operatorError(msg, t));
    }
  }

  const keyFromEnv = Boolean(draft.secrets.adapters?.[draft.agent.adapter]?.apiKey.fromEnv);
  const keyConfigured =
    draft.secrets.adapters?.[draft.agent.adapter]?.apiKey.configured ||
    (draft.agent.adapter === "cursor" && draft.secrets.cursorApiKey.configured);

  return (
    <div className="settings-overlay" onClick={requestClose}>
      <div
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2 id="settings-title">{t("settings.title")}</h2>
          <button ref={closeRef} className="ghost" type="button" onClick={requestClose}>
            {t("settings.close")}
          </button>
        </header>
        <div className="settings-body">
          <nav className="settings-toc" aria-label={t("settings.title")}>
            <a href="#settings-appearance">{t("settings.appearance")}</a>
            <a href="#settings-agent">{t("settings.agent")}</a>
            <a href="#settings-session">{t("settings.session")}</a>
            <a href="#settings-prompts">{t("settings.prompts")}</a>
            <a href="#settings-schedules">{t("settings.schedules")}</a>
            <a href="#settings-updates">{t("settings.update")}</a>
            <a href="#settings-phone">{t("settings.phone")}</a>
          </nav>
          {config.restartRequired && (
            <p className="warn">
              {t("settings.restartRequired")}{" "}
              <button
                type="button"
                className="ghost tiny"
                onClick={() => {
                  setRestartNote(t("settings.restarting"));
                  void api.restart().catch((err) => {
                    setRestartNote(operatorError(err instanceof Error ? err.message : t("settings.restartFailed"), t));
                  });
                }}
              >
                {t("settings.restart")}
              </button>
              {restartNote ? ` ${restartNote}` : ""}
            </p>
          )}
          <section className="settings-section" id="settings-appearance">
            <h3>{t("settings.appearance")}</h3>
            <label>
              {t("settings.locale")}
              <select
                value={draft.space.locale}
                onChange={(e) => setDraft({ ...draft, space: { ...draft.space, locale: e.target.value } })}
              >
                <option value="en">English</option>
                <option value="es">Español</option>
              </select>
            </label>
            <label>
              {t("settings.theme")}
              <select
                value={draft.space.theme}
                onChange={(e) => {
                  const next = e.target.value;
                  if (!isTheme(next)) return;
                  setDraft({ ...draft, space: { ...draft.space, theme: next } });
                }}
              >
                <option value="dark">{t("settings.theme.dark")}</option>
                <option value="light">{t("settings.theme.light")}</option>
                <option value="system">{t("settings.theme.system")}</option>
              </select>
            </label>
            <label>
              {t("settings.hostLabel")}
              <input
                value={draft.space.name}
                maxLength={40}
                onChange={(e) => setDraft({ ...draft, space: { ...draft.space, name: e.target.value } })}
              />
            </label>
            <p className="muted">{t("settings.hostLabelHint")}</p>
            <label>
              {t("settings.thinking")}
              <select
                value={draft.display.thinkingDefault}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    display: { ...draft.display, thinkingDefault: e.target.value as "collapsed" | "expanded" },
                  })
                }
              >
                <option value="collapsed">{t("settings.thinking.collapsed")}</option>
                <option value="expanded">{t("settings.thinking.expanded")}</option>
              </select>
            </label>
            <label className="choice">
              <input
                type="checkbox"
                checked={draft.display.diffPreview}
                onChange={(e) => setDraft({ ...draft, display: { ...draft.display, diffPreview: e.target.checked } })}
              />
              {t("settings.diffs")}
            </label>
            <label>
              {t("settings.shellLines")}
              <input
                type="number"
                min={1}
                max={200}
                value={Number.isFinite(draft.display.shellLinesVisible) ? draft.display.shellLinesVisible : 12}
                onChange={(e) => {
                  const n = Number.parseInt(e.target.value, 10);
                  setDraft({
                    ...draft,
                    display: {
                      ...draft.display,
                      shellLinesVisible: Number.isFinite(n) ? Math.max(1, Math.min(200, n)) : draft.display.shellLinesVisible,
                    },
                  });
                }}
              />
            </label>
          </section>

          <section className="settings-section" id="settings-agent">
            <h3>{t("settings.agent")}</h3>
            <p className="warn">{t("settings.newThread")}</p>
            <label>
              {t("wizard.step.adapter")}
              <select value={draft.agent.adapter} onChange={(e) => pickAdapter(e.target.value)}>
                {adapters.map((a) => (
                  <option key={a.id} value={a.id} disabled={!adapterSelectable(a) && a.id !== draft.agent.adapter}>
                    {a.displayName}
                  </option>
                ))}
              </select>
            </label>
            {currentAdapter && !adapterSelectable(currentAdapter) && currentAdapter.available && !currentAdapter.available.ok && (
              <p className="warn">
                {t("wizard.adapter.unavailable")} {currentAdapter.available.error}
              </p>
            )}
            {adaptersError && (
              <p className="error-text">
                {adaptersError}{" "}
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setAdaptersError("");
                    api
                      .adapters()
                      .then((r) => {
                        setAdapters(r.adapters);
                        setAdaptersError(r.adapters.length ? "" : t("wizard.adapters.empty"));
                      })
                      .catch(() => setAdaptersError(t("wizard.adapters.failed")));
                  }}
                >
                  {t("wizard.adapters.retry")}
                </button>
              </p>
            )}
            {currentAdapter?.description && <p className="muted">{currentAdapter.description}</p>}
            <WorkspacePicker
              value={draft.agent.cwd}
              onChange={(cwd) => setDraft({ ...draft, agent: { ...draft.agent, cwd } })}
            />
            <CatalogFallbackNotice liveCatalog={caps?.liveCatalog} source={modelSource} error={modelError} />
            {caps?.models !== false && (
              <ModelPicker
                models={models}
                modelId={draft.agent.model}
                params={draft.agent.modelParams ?? []}
                preferred={caps?.defaultModel}
                onChange={(model, modelParams) => setDraft({ ...draft, agent: { ...draft.agent, model, modelParams } })}
              />
            )}
            {caps?.settingSources &&
              (["project", "user", "plugins"] as SettingSource[]).map((s) => (
                <label key={s} className="choice">
                  <input
                    type="checkbox"
                    checked={optionStringArray(draft.agent.options, "settingSources", ["project", "user"]).includes(s)}
                    onChange={(e) => toggleSource(s, e.target.checked)}
                  />
                  {t(`wizard.rules.${s}`)}
                </label>
              ))}
            {caps?.sandbox && (
              <label className="choice">
                <input
                  type="checkbox"
                  checked={optionBool(draft.agent.options, "sandbox", false)}
                  onChange={(e) =>
                    setDraft({ ...draft, agent: { ...draft.agent, options: setOption(draft.agent.options, "sandbox", e.target.checked) } })
                  }
                />
                {t("wizard.exec.sandbox")}
              </label>
            )}
            {caps?.autoRun && (
              <label className="choice">
                <input
                  type="checkbox"
                  checked={optionBool(draft.agent.options, "autoRun", true)}
                  onChange={(e) =>
                    setDraft({ ...draft, agent: { ...draft.agent, options: setAutoRun(draft.agent.options, e.target.checked, caps?.toolConfirmation) } })
                  }
                />
                {t("wizard.exec.autoRun")}
              </label>
            )}
            {caps?.toolConfirmation === "auto-review-deny" && <p className="muted">{t("wizard.exec.danger")}</p>}
            {caps?.toolConfirmation === "none" && <p className="muted">{t("wizard.exec.unattended")}</p>}
            {caps?.toolConfirmation === "permission-mode" && (
              <>
                <label>
                  {t("wizard.exec.permissionMode")}
                  <select
                    value={optionString(draft.agent.options, "permissionMode", "bypassPermissions")}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        agent: { ...draft.agent, options: setPermissionMode(draft.agent.options, e.target.value) },
                      })
                    }
                  >
                    <option value="bypassPermissions">{t("wizard.exec.permission.bypass")}</option>
                    <option value="dontAsk">{t("wizard.exec.permission.dontAsk")}</option>
                    <option value="acceptEdits">{t("wizard.exec.permission.acceptEdits")}</option>
                  </select>
                </label>
                <p className="muted">{t("wizard.exec.permission.hint")}</p>
              </>
            )}
            {caps?.discover && (
              <>
                {discover.length > 0 && (
                  <label>
                    {t("wizard.acp.registry")}
                    <select
                      value={optionString(draft.agent.options, "registryId", "")}
                      onChange={(e) => {
                        const item = discover.find((d) => d.id === e.target.value);
                        setDraft({
                          ...draft,
                          agent: {
                            ...draft.agent,
                            options: {
                              ...draft.agent.options,
                              registryId: e.target.value,
                              command: item?.command || optionString(draft.agent.options, "command", ""),
                              args: item?.args || optionStringArray(draft.agent.options, "args", []),
                            },
                          },
                        });
                      }}
                    >
                      <option value="">{t("wizard.acp.custom")}</option>
                      {discover.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  {t("wizard.acp.command")}
                  <input
                    value={optionString(draft.agent.options, "command", "")}
                    onChange={(e) =>
                      setDraft({ ...draft, agent: { ...draft.agent, options: setOption(draft.agent.options, "command", e.target.value) } })
                    }
                  />
                </label>
                <label>
                  {t("wizard.acp.args")}
                  <input
                    value={optionStringArray(draft.agent.options, "args", []).join(" ")}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        agent: {
                          ...draft.agent,
                          options: setOption(
                            draft.agent.options,
                            "args",
                            e.target.value.split(/\s+/).filter(Boolean),
                          ),
                        },
                      })
                    }
                  />
                </label>
              </>
            )}
            {caps?.auth.kind === "sdk-login" &&
              (auth?.loggedIn ? (
                <p className="ok">
                  {t("wizard.cred.signedIn")}
                  {auth.email ? ` (${auth.email})` : ""}
                </p>
              ) : (
                <p className="muted">{t("wizard.cred.signedOut")}</p>
              ))}
            {caps?.auth.kind === "sdk-login" && (
              <SdkLoginControls
                adapterId={draft.agent.adapter}
                onSignedIn={async () => {
                  setAuth(await api.adapterStatus(draft.agent.adapter));
                  await loadModels(draft.agent.adapter);
                }}
              />
            )}
            {keyConfigured && <p className="ok">{t("wizard.cred.keyConfigured")}</p>}
            {keyFromEnv && <p className="warn">{t("settings.cred.fromEnv")}</p>}
            <details>
              <summary>{t("wizard.cred.optional")}</summary>
              <label>
                {t("wizard.cred.rotate")}
                <input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
              </label>
              <p className="muted">
                {t("wizard.cred.keyHint")}
                {caps?.auth.envNames?.length ? ` (${caps.auth.envNames.join(", ")})` : ""}
              </p>
              {keyConfigured && (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setClearKey(true);
                    setApiKey("");
                  }}
                >
                  {t("wizard.cred.clearKey")}
                </button>
              )}
              {clearKey && <p className="warn">{t("settings.clearKeyWarn")}</p>}
            </details>
          </section>

          <section className="settings-section" id="settings-session">
            <h3>{t("settings.session")}</h3>
            {caps?.resume && (
            <label className="choice">
              <input
                type="checkbox"
                checked={draft.session.resumeOnStart}
                onChange={(e) => setDraft({ ...draft, session: { ...draft.session, resumeOnStart: e.target.checked } })}
              />
              {t("settings.resume")}
            </label>
            )}
            <label>
              {t("settings.stall")}
              <select
                value={draft.session.stallSeconds}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    session: { ...draft.session, stallSeconds: Number.parseInt(e.target.value, 10) || 0 },
                  })
                }
              >
                <option value={0}>{t("settings.stall.off")}</option>
                <option value={60}>{t("settings.stall.60")}</option>
                <option value={180}>{t("settings.stall.180")}</option>
                <option value={300}>{t("settings.stall.300")}</option>
              </select>
            </label>
            <label className="choice">
              <input
                type="checkbox"
                checked={draft.session.notifyOnComplete}
                onChange={(e) => void enableNotify(e.target.checked)}
              />
              {t("settings.notify")}
            </label>
            <p className="muted">{t("settings.notifyHint")}</p>
            {notifyNote && <p className="warn">{notifyNote}</p>}
            <label>
              {t("settings.password")}
              <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <p className="muted">{t("settings.passwordHint")}</p>
          </section>

          <section className="settings-section">
            <h3>{t("settings.usage")}</h3>
            {threadUsage && (
              <p>
                {t("settings.usageThread")}: ↓{threadUsage.inputTokens} ↑{threadUsage.outputTokens}
              </p>
            )}
            {usage && (
              <>
                <p>
                  {t("settings.usageAll")}: ↓{usage.inputTokens} ↑{usage.outputTokens}
                </p>
                {Object.entries(usage.byAdapter).map(([id, tot]) => (
                  <p key={id} className="muted">
                    {id}: ↓{tot.inputTokens} ↑{tot.outputTokens}
                  </p>
                ))}
              </>
            )}
          </section>

          <section className="settings-section" id="settings-prompts">
            <h3>{t("settings.prompts")}</h3>
            <p className="muted">{t("settings.promptsHint")}</p>
            {templates.map((tpl, i) => (
              <div key={tpl.id} className="prompt-row">
                <label>
                  {t("settings.promptSlash")}
                  <input
                    value={tpl.slash}
                    onChange={(e) => {
                      const next = templates.slice();
                      next[i] = { ...tpl, slash: e.target.value, id: tpl.id || e.target.value };
                      setTemplates(next);
                    }}
                  />
                </label>
                <label>
                  {t("settings.promptTitle")}
                  <input
                    value={tpl.title}
                    onChange={(e) => {
                      const next = templates.slice();
                      next[i] = { ...tpl, title: e.target.value };
                      setTemplates(next);
                    }}
                  />
                </label>
                <label>
                  {t("settings.promptText")}
                  <textarea
                    rows={3}
                    value={tpl.text}
                    onChange={(e) => {
                      const next = templates.slice();
                      next[i] = { ...tpl, text: e.target.value };
                      setTemplates(next);
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="ghost tiny"
                  onClick={() => setTemplates(templates.filter((_, j) => j !== i))}
                >
                  {t("settings.promptRemove")}
                </button>
              </div>
            ))}
            <button
              type="button"
              className="ghost"
              onClick={() =>
                setTemplates([
                  ...templates,
                  { id: `tpl-${templates.length + 1}`, slash: "", title: "", text: "" },
                ])
              }
            >
              {t("settings.promptAdd")}
            </button>
          </section>

          <section className="settings-section" id="settings-schedules">
            <h3>{t("settings.schedules")}</h3>
            <p className="muted">{t("settings.schedulesHint")}</p>
            {scheduleTz && (
              <p className="muted">
                {t("settings.scheduleTz")}: {scheduleTz}
              </p>
            )}
            <p className="muted">{t("settings.scheduleCatchUp")}</p>
            <label>
              {t("settings.scheduleText")}
              <textarea rows={3} value={scheduleText} onChange={(e) => setScheduleText(e.target.value)} />
            </label>
            <label>
              {t("settings.scheduleCron")}
              <input
                value={scheduleCron}
                placeholder="0 6 * * *"
                onChange={(e) => {
                  setScheduleCron(e.target.value);
                  if (e.target.value) setScheduleAt("");
                }}
              />
            </label>
            <label>
              {t("settings.scheduleAt")}
              <input
                type="datetime-local"
                value={scheduleAt}
                onChange={(e) => {
                  setScheduleAt(e.target.value);
                  if (e.target.value) setScheduleCron("");
                }}
              />
            </label>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                void (async () => {
                  try {
                    await api.createSchedule({
                      text: scheduleText,
                      cwd: draft.agent.cwd,
                      threadId: currentThreadId || undefined,
                      cron: scheduleCron.trim() || undefined,
                      at: scheduleAt ? new Date(scheduleAt).toISOString() : undefined,
                    });
                    setScheduleText("");
                    setScheduleCron("");
                    setScheduleAt("");
                    await refreshSchedules();
                  } catch (err) {
                    setError(operatorError(err instanceof Error ? err.message : String(err), t));
                  }
                })();
              }}
            >
              {t("settings.scheduleAdd")}
            </button>
            {schedules.length === 0 && <p className="muted">{t("settings.scheduleEmpty")}</p>}
            <ul className="schedule-list">
              {schedules.map((job) => (
                <li key={job.id}>
                  <p>{job.text}</p>
                  <p className="muted">
                    {job.cron || job.at} · {t("settings.scheduleNext")} {job.nextRun || "—"} · {job.cwd}
                  </p>
                  {job.lastRun && (
                    <p className="muted">
                      {t("settings.scheduleLast")}: {job.lastRun}
                    </p>
                  )}
                  {job.lastError && (
                    <p className="warn">
                      {t("settings.scheduleLastError")}: {job.lastError}
                    </p>
                  )}
                  <label className="choice">
                    <input
                      type="checkbox"
                      checked={job.enabled}
                      onChange={(e) => {
                        void api
                          .patchSchedule(job.id, { enabled: e.target.checked })
                          .then(() => refreshSchedules())
                          .catch((err) => setError(operatorError(err instanceof Error ? err.message : String(err), t)));
                      }}
                    />
                    {t("settings.scheduleEnable")}
                  </label>
                  <button
                    type="button"
                    className="ghost tiny"
                    onClick={() => {
                      void api
                        .deleteSchedule(job.id)
                        .then(() => refreshSchedules())
                        .catch((err) => setError(operatorError(err instanceof Error ? err.message : String(err), t)));
                    }}
                  >
                    {t("settings.promptRemove")}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="settings-section" id="settings-updates">
            <h3>{t("settings.update")}</h3>
            {update && (
              <>
                <p>
                  {t("settings.updateVersion")}: {update.version}
                  {update.git ? ` · ${update.git.branch} ${update.git.sha.slice(0, 7)}${update.git.dirty ? "*" : ""}` : ""}
                </p>
                <p className="muted">{t("settings.updateService")}: {update.service}</p>
                {behind !== null && (
                  <p>
                    {behind} {t("settings.updateBehind")}
                  </p>
                )}
                {update.upgrading?.phase && update.upgrading.phase !== "idle" && (
                  <p className="warn" role="status">
                    {update.upgrading.phase === "error"
                      ? `${t("settings.updateFailed")} ${update.upgrading.error || ""}`
                      : t("settings.updating")}
                  </p>
                )}
              </>
            )}
            <div className="row">
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  void api
                    .adminUpdateCheck()
                    .then((r) => setBehind(r.behind))
                    .catch((err) => setError(operatorError(err instanceof Error ? err.message : String(err), t)));
                }}
              >
                {t("settings.updateCheck")}
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  void (async () => {
                    if (update?.git?.dirty) {
                      setError(t("settings.updateDirty"));
                      return;
                    }
                    if (!window.confirm(t("settings.updateConfirm"))) return;
                    try {
                      await api.upgrade();
                      setUpdate(await api.adminUpdate());
                    } catch (err) {
                      const msg = err instanceof Error ? err.message : "";
                      setError(msg.includes("user service") ? t("settings.updateNeedService") : operatorError(msg, t));
                    }
                  })();
                }}
              >
                {t("settings.updateNow")}
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setRestartNote(t("settings.restarting"));
                  void api.restart().catch((err) => {
                    setRestartNote(operatorError(err instanceof Error ? err.message : t("settings.restartFailed"), t));
                  });
                }}
              >
                {t("settings.restart")}
              </button>
              {restartNote ? <span className="muted">{restartNote}</span> : null}
            </div>
            {update?.service === "none" && <p className="muted">{t("settings.updateNeedService")}</p>}
          </section>

          <section className="settings-section" id="settings-phone">
            <h3>{t("settings.phone")}</h3>
            <ReachabilityCard />
          </section>

          {error && <p className="error-text">{error}</p>}
          {saved && <p className="ok">{saved}</p>}
        </div>
        <footer>
          <button
            type="button"
            className="ghost"
            onClick={async () => {
              await api.logout();
              clearToken();
              onLogout();
            }}
          >
            {t("settings.logout")}
          </button>
          <button type="button" className="primary" onClick={() => void save()} disabled={submitting}>
            {t("settings.save")}
          </button>
        </footer>
      </div>
    </div>
  );
}
