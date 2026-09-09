import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  AdapterDiscoverItem,
  AdapterPublicInfo,
  ModelCatalogItem,
  ModelListSource,
  PromptTemplate,
  RedactedConfig,
  SettingSource,
} from "@glassys/protocol";
import { pickDefaultSelection, adapterSelectable } from "@glassys/protocol";
import { api, clearToken } from "../api";
import { useT } from "../i18n";
import { paramsForSelection } from "../components/ModelPicker";
import { defaultOptionsFor, optionString, optionStringArray, setOption, archivesLiveThread } from "../adapterOptions";
import { operatorError } from "../operatorError";
import { enableWebPush, disableWebPush } from "../push";
import { useConfirm } from "../components/ConfirmDialog";
import {
  IconChart,
  IconClock,
  IconClose,
  IconCommand,
  IconPalette,
  IconPhone,
  IconRefresh,
  IconServer,
  IconTerminal,
} from "../components/Icon";
import { AppearanceTab } from "./settings/AppearanceTab";
import { AgentTab } from "./settings/AgentTab";
import { SessionTab } from "./settings/SessionTab";
import { PromptsTab } from "./settings/PromptsTab";
import { SchedulesTab, type ScheduleJob } from "./settings/SchedulesTab";
import { UpdatesTab, type UpdateInfo } from "./settings/UpdatesTab";
import { PhoneTab } from "./settings/PhoneTab";
import { UsageTab } from "./settings/UsageTab";

export type SettingsTab =
  | "appearance"
  | "agent"
  | "session"
  | "prompts"
  | "schedules"
  | "updates"
  | "phone"
  | "usage";

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
  const { confirm, confirmDialog } = useConfirm();
  const [tab, setTab] = useState<SettingsTab>(focusSection ?? "appearance");
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
  const [schedules, setSchedules] = useState<ScheduleJob[]>([]);
  const [scheduleTz, setScheduleTz] = useState("");
  const [scheduleText, setScheduleText] = useState("");
  const [scheduleCron, setScheduleCron] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
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

  async function requestClose() {
    if (dirty && !(await confirm({ message: t("settings.discard"), confirmLabel: t("confirm.discard"), destructive: true })))
      return;
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
    setTab(focusSection);
  }, [focusSection]);

  useEffect(() => {
    closeRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const root = document.querySelector(".settings-dialog");
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        void requestCloseRef.current();
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
    if (
      archivesLiveThread(config.agent, draft.agent) &&
      !(await confirm({ message: t("settings.archiveConfirm"), confirmLabel: t("confirm.archive") }))
    ) {
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
  /* The strip needs one word per tab; the panel heading keeps the longer,
     descriptive string. */
  const tabs: Array<{ id: SettingsTab; label: string; heading: string; glyph: ReactNode }> = [
    { id: "appearance", label: t("settings.tab.appearance"), heading: t("settings.appearance"), glyph: <IconPalette /> },
    { id: "agent", label: t("settings.tab.agent"), heading: t("settings.agent"), glyph: <IconTerminal /> },
    { id: "session", label: t("settings.tab.session"), heading: t("settings.session"), glyph: <IconServer /> },
    { id: "prompts", label: t("settings.tab.prompts"), heading: t("settings.prompts"), glyph: <IconCommand /> },
    { id: "schedules", label: t("settings.tab.schedules"), heading: t("settings.schedules"), glyph: <IconClock /> },
    { id: "updates", label: t("settings.tab.updates"), heading: t("settings.update"), glyph: <IconRefresh /> },
    { id: "phone", label: t("settings.tab.phone"), heading: t("settings.phone"), glyph: <IconPhone /> },
    { id: "usage", label: t("settings.tab.usage"), heading: t("settings.usage"), glyph: <IconChart /> },
  ];

  return (
    <div className="settings-overlay" onClick={() => void requestClose()}>
      <div
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2 id="settings-title">{t("settings.title")}</h2>
          <button
            ref={closeRef}
            className="icon-btn"
            type="button"
            aria-label={t("settings.close")}
            title={t("settings.close")}
            onClick={() => void requestClose()}
          >
            <IconClose />
          </button>
        </header>
        <div className="settings-layout">
          {/* Eight sections stacked in a 520px column needed an anchor index to
              navigate. Tabs remove the need for one. */}
          <nav className="settings-tabs" aria-label={t("settings.title")}>
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`settings-tab${tab === item.id ? " current" : ""}`}
                aria-current={tab === item.id ? "true" : undefined}
                onClick={() => setTab(item.id)}
              >
                {item.glyph}
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="settings-body">
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
            <section className="settings-section" id={`settings-${tab}`}>
              <h3>{tabs.find((item) => item.id === tab)?.heading}</h3>
              {tab === "appearance" && <AppearanceTab draft={draft} setDraft={setDraft} />}
              {tab === "agent" && (
                <AgentTab
                  draft={draft}
                  setDraft={setDraft}
                  adapters={adapters}
                  setAdapters={setAdapters}
                  adaptersError={adaptersError}
                  setAdaptersError={setAdaptersError}
                  currentAdapter={currentAdapter}
                  models={models}
                  modelSource={modelSource}
                  modelError={modelError}
                  auth={auth}
                  setAuth={setAuth}
                  discover={discover}
                  apiKey={apiKey}
                  setApiKey={setApiKey}
                  clearKey={clearKey}
                  setClearKey={setClearKey}
                  keyConfigured={Boolean(keyConfigured)}
                  keyFromEnv={keyFromEnv}
                  loadModels={loadModels}
                  pickAdapter={pickAdapter}
                  toggleSource={toggleSource}
                />
              )}
              {tab === "session" && (
                <SessionTab
                  draft={draft}
                  setDraft={setDraft}
                  caps={caps}
                  password={password}
                  setPassword={setPassword}
                  notifyNote={notifyNote}
                  enableNotify={enableNotify}
                  onLogout={() => {
                    void (async () => {
                      await api.logout();
                      clearToken();
                      onLogout();
                    })();
                  }}
                />
              )}
              {tab === "prompts" && <PromptsTab templates={templates} setTemplates={setTemplates} />}
              {tab === "schedules" && (
                <SchedulesTab
                  draft={draft}
                  schedules={schedules}
                  scheduleTz={scheduleTz}
                  scheduleText={scheduleText}
                  setScheduleText={setScheduleText}
                  scheduleCron={scheduleCron}
                  setScheduleCron={setScheduleCron}
                  scheduleAt={scheduleAt}
                  setScheduleAt={setScheduleAt}
                  currentThreadId={currentThreadId}
                  refreshSchedules={refreshSchedules}
                  setError={setError}
                />
              )}
              {tab === "updates" && (
                <UpdatesTab
                  update={update}
                  setUpdate={setUpdate}
                  behind={behind}
                  setBehind={setBehind}
                  restartNote={restartNote}
                  setRestartNote={setRestartNote}
                  setError={setError}
                  confirm={confirm}
                />
              )}
              {tab === "phone" && <PhoneTab />}
              {tab === "usage" && <UsageTab usage={usage} threadUsage={threadUsage} locale={draft.space.locale} />}
            </section>
            {error && <p className="error-text">{error}</p>}
            {saved && <p className="ok">{saved}</p>}
          </div>
        </div>
        <footer>
          <span className="muted settings-dirty">{dirty ? t("settings.unsaved") : ""}</span>
          <div className="row">
            <button type="button" className="ghost" onClick={() => void requestClose()}>
              {t("confirm.cancel")}
            </button>
            <button type="button" className="primary" onClick={() => void save()} disabled={submitting || !dirty}>
              {t("settings.save")}
            </button>
          </div>
        </footer>
      </div>
      {confirmDialog}
    </div>
  );
}
