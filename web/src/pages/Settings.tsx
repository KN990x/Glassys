import { useEffect, useRef, useState } from "react";
import type {
  AdapterDiscoverItem,
  AdapterPublicInfo,
  ModelCatalogItem,
  ModelListSource,
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

export function Settings({
  config,
  onClose,
  onConfig,
  onLogout,
}: {
  config: RedactedConfig;
  onClose: () => void;
  onConfig: (c: RedactedConfig) => void;
  onLogout: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState(config);
  const [password, setPassword] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const [models, setModels] = useState<ModelCatalogItem[]>([]);
  const [modelSource, setModelSource] = useState<ModelListSource>("live");
  const [modelError, setModelError] = useState("");
  const [adapters, setAdapters] = useState<AdapterPublicInfo[]>([]);
  const [adaptersError, setAdaptersError] = useState("");
  const [auth, setAuth] = useState<{ loggedIn: boolean; email?: string; apiKeyConfigured: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [discover, setDiscover] = useState<AdapterDiscoverItem[]>([]);
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
    }) !==
      JSON.stringify({
        space: config.space,
        agent: config.agent,
        display: config.display,
        session: config.session,
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
          {config.restartRequired && (
            <p className="warn">
              {t("settings.restartRequired")}{" "}
              <button type="button" className="ghost tiny" onClick={() => void api.restart()}>
                {t("settings.restart")}
              </button>
            </p>
          )}
          <section className="settings-section">
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

          <section className="settings-section">
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

          <section className="settings-section">
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
              {t("settings.password")}
              <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
          </section>

          <section className="settings-section">
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
