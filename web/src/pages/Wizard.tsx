import { useEffect, useMemo, useState } from "react";
import type {
  AdapterDiscoverItem,
  AdapterPublicInfo,
  ModelCatalogItem,
  ModelListSource,
  ModelParam,
  RedactedConfig,
  SettingSource,
  Theme,
} from "@glassys/protocol";
import { pickDefaultSelection, adapterSelectable } from "@glassys/protocol";
import { api } from "../api";
import { useT } from "../i18n";
import { ModelPicker, paramsForSelection } from "../components/ModelPicker";
import { CatalogFallbackNotice } from "../components/CatalogFallback";
import { SdkLoginControls } from "../components/SdkLogin";
import { WorkspacePicker } from "../components/WorkspacePicker";
import { ReachabilityCard } from "../components/Reachability";
import { defaultOptionsFor, optionBool, optionString, optionStringArray, optionsForAdapter, setOption, setAutoRun, setPermissionMode, adapterKeyConfigured } from "../adapterOptions";
import { operatorError } from "../operatorError";
import { Callout, StatusBadge } from "../components/Primitives";
import { Switch } from "../components/Switch";
import { GlassysMark, IconCheck } from "../components/Icon";

type StepId = "adapter" | "workspace" | "phone" | "credential" | "model" | "rules" | "execution" | "acp";

export function wizardStepIds(caps?: {
  models?: boolean;
  discover?: boolean;
  settingSources?: boolean;
  sandbox?: boolean;
  autoRun?: boolean;
  toolConfirmation?: string;
}): StepId[] {
  const s: StepId[] = ["adapter", "workspace", "phone", "credential"];
  if (caps?.models !== false) s.push("model");
  if (caps?.discover) s.push("acp");
  if (caps?.settingSources) s.push("rules");
  if (caps?.sandbox || caps?.autoRun || caps?.toolConfirmation === "permission-mode") s.push("execution");
  return s;
}

export function wizardFinishPatch(input: {
  adapterId: string;
  cwd: string;
  model: string;
  modelParams: ModelParam[];
  options: Record<string, unknown>;
}) {
  return {
    agent: {
      adapter: input.adapterId,
      cwd: input.cwd,
      model: input.model,
      modelParams: input.modelParams,
      options: input.options,
    },
    onboarding: { completed: true as const },
  };
}

export function pickWizardAdapter(adapters: AdapterPublicInfo[], preferred?: string): string | undefined {
  const want = adapters.find((a) => a.id === preferred);
  if (want && adapterSelectable(want)) return want.id;
  return adapters.find(adapterSelectable)?.id;
}

export function wizardCredentialReady(input: {
  authKind?: string;
  loggedIn?: boolean;
  keyConfigured?: boolean;
  apiKeyDraft?: string;
}): boolean {
  if (input.authKind !== "sdk-login") return true;
  return Boolean(input.loggedIn || input.keyConfigured || input.apiKeyDraft?.trim());
}

export function Wizard({ config, onDone, onConfig }: { config: RedactedConfig; onDone: () => void; onConfig: (c: RedactedConfig) => void }) {
  const t = useT();
  const [step, setStep] = useState(0);
  const [adapters, setAdapters] = useState<AdapterPublicInfo[]>([]);
  const [adaptersReady, setAdaptersReady] = useState(false);
  const [adapterId, setAdapterId] = useState(config.agent.adapter || "cursor");
  const [cwd, setCwd] = useState(config.agent.cwd);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(config.agent.model);
  const [modelParams, setModelParams] = useState<ModelParam[]>(config.agent.modelParams ?? []);
  const [models, setModels] = useState<ModelCatalogItem[]>([]);
  const [modelSource, setModelSource] = useState<ModelListSource>("live");
  const [modelError, setModelError] = useState("");
  const [auth, setAuth] = useState<{ loggedIn: boolean; email?: string; apiKeyConfigured: boolean } | null>(null);
  const [options, setOptions] = useState<Record<string, unknown>>(config.agent.options ?? {});
  const [error, setError] = useState("");
  const [adaptersError, setAdaptersError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [discover, setDiscover] = useState<AdapterDiscoverItem[]>([]);
  const [locale, setLocale] = useState(() => {
    if (config.space.locale === "es" || config.space.locale === "en") return config.space.locale;
    try {
      const stored = localStorage.getItem("glassys_locale");
      if (stored === "es" || stored === "en") return stored;
    } catch {
      /* private mode */
    }
    return "en";
  });
  const [theme, setTheme] = useState(config.space.theme);

  const current = adapters.find((a) => a.id === adapterId) ?? adapters[0];
  const caps = current?.capabilities;

  const steps = useMemo<StepId[]>(() => wizardStepIds(caps), [adapterId, caps]);

  useEffect(() => {
    setStep((s) => Math.min(s, Math.max(0, steps.length - 1)));
  }, [steps.length]);

  const id = steps[Math.min(step, steps.length - 1)] ?? "adapter";

  function loadAdapters() {
    setAdaptersReady(false);
    setAdaptersError("");
    api
      .adapters()
      .then((r) => {
        setAdapters(r.adapters);
        setAdaptersReady(true);
        if (!r.adapters.length) setAdaptersError(t("wizard.adapters.empty"));
        else {
          const nextId = pickWizardAdapter(r.adapters, adapterId);
          if (nextId && nextId !== adapterId) setAdapterId(nextId);
        }
      })
      .catch(() => {
        setAdapters([]);
        setAdaptersReady(true);
        setAdaptersError(t("wizard.adapters.failed"));
      });
  }

  useEffect(() => {
    loadAdapters();
  }, []);

  useEffect(() => {
    if (current) setOptions(optionsForAdapter(current, config.agent));
  }, [current?.id]);

  async function refreshAuth() {
    try {
      setAuth(await api.adapterStatus(adapterId));
    } catch {
      setAuth(null);
    }
  }

  useEffect(() => {
    if (id === "credential") void refreshAuth();
  }, [id, adapterId]);

  useEffect(() => {
    if (id !== "model") return;
    let cancelled = false;
    api
      .models(adapterId)
      .then((r) => {
        if (cancelled) return;
        setModels(r.models);
        setModelSource(r.source);
        setModelError(r.error || "");
        const preferred = current?.capabilities.defaultModel;
        setModel((cur) => {
          if (!config.onboarding.completed && (!cur || !r.models.some((m) => m.id === cur))) {
            const sel = pickDefaultSelection(r.models, preferred?.id);
            const item = r.models.find((m) => m.id === sel.id);
            setModelParams(paramsForSelection(item, preferred));
            return sel.id;
          }
          return cur;
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setModels([]);
        setModelSource("fallback");
        setModelError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [id, adapterId, config.onboarding.completed, current?.capabilities.defaultModel]);

  useEffect(() => {
    if (id !== "acp" || !caps?.discover) {
      setDiscover([]);
      return;
    }
    api.discover(adapterId).then((r) => setDiscover(r.agents)).catch(() => setDiscover([]));
  }, [id, adapterId, caps?.discover]);

  async function next() {
    if (submitting) return;
    setError("");
    if (!adaptersReady || !adapters.length) {
      setError(t("wizard.adapters.loading"));
      return;
    }
    if (id === "adapter") {
      if (!current || !adapterSelectable(current)) {
        setError(t("wizard.adapter.unavailable"));
        return;
      }
    }
    if (id === "workspace" && !cwd.trim()) {
      setError(t("wizard.workspace.required"));
      return;
    }
    if (
      id === "credential" &&
      !wizardCredentialReady({
        authKind: caps?.auth.kind,
        loggedIn: auth?.loggedIn,
        keyConfigured: adapterKeyConfigured(config.secrets, adapterId),
        apiKeyDraft: apiKey,
      })
    ) {
      setError(t("wizard.cred.required"));
      return;
    }
    if (id === "model" && caps?.models !== false && !model.trim()) {
      setError(t("wizard.model.required"));
      return;
    }
    if (id === "acp" && !optionString(options, "command", "").trim()) {
      setError(t("wizard.acp.commandRequired"));
      return;
    }
    setSubmitting(true);
    try {
      if (id === "adapter" && current) {
        onConfig(
          await api.saveConfig({
            space: { locale, theme },
            agent: {
              adapter: adapterId,
              model: current.capabilities.defaultModel?.id || model,
              modelParams: current.capabilities.defaultModel?.params || modelParams,
              options: defaultOptionsFor(current),
            },
          }),
        );
        setOptions(defaultOptionsFor(current));
      } else if (id === "workspace") {
        onConfig(await api.saveConfig({ agent: { cwd } }));
      } else if (id === "credential") {
        if (apiKey) onConfig(await api.saveConfig({ adapterApiKey: { adapter: adapterId, value: apiKey } }));
        const r = await api.models(adapterId).catch(() => null);
        if (r) {
          setModels(r.models);
          setModelSource(r.source);
          setModelError(r.error || "");
        }
      } else if (id === "model") {
        onConfig(await api.saveConfig({ agent: { model, modelParams } }));
      } else if (id === "acp") {
        onConfig(await api.saveConfig({ agent: { options } }));
      } else if (id === "rules") {
        onConfig(await api.saveConfig({ agent: { options } }));
      } else if (id === "execution") {
        if (!cwd.trim()) {
          setError(t("wizard.workspace.required"));
          return;
        }
        if (!current || !adapterSelectable(current)) {
          setError(t("wizard.adapter.unavailable"));
          return;
        }
        if (caps?.discover && !optionString(options, "command", "").trim()) {
          setError(t("wizard.acp.commandRequired"));
          return;
        }
        if (caps?.models !== false && !model.trim()) {
          setError(t("wizard.model.required"));
          return;
        }
        if (
          !wizardCredentialReady({
            authKind: caps?.auth.kind,
            loggedIn: auth?.loggedIn,
            keyConfigured: adapterKeyConfigured(config.secrets, adapterId),
            apiKeyDraft: apiKey,
          })
        ) {
          setError(t("wizard.cred.required"));
          return;
        }
        await api.saveConfig(
          wizardFinishPatch({ adapterId, cwd, model, modelParams, options }),
        );
        onDone();
        return;
      }
      if (step >= steps.length - 1) {
        if (!cwd.trim()) {
          setError(t("wizard.workspace.required"));
          return;
        }
        if (!current || !adapterSelectable(current)) {
          setError(t("wizard.adapter.unavailable"));
          return;
        }
        if (caps?.discover && !optionString(options, "command", "").trim()) {
          setError(t("wizard.acp.commandRequired"));
          return;
        }
        if (caps?.models !== false && !model.trim()) {
          setError(t("wizard.model.required"));
          return;
        }
        if (
          !wizardCredentialReady({
            authKind: caps?.auth.kind,
            loggedIn: auth?.loggedIn,
            keyConfigured: adapterKeyConfigured(config.secrets, adapterId),
            apiKeyDraft: apiKey,
          })
        ) {
          setError(t("wizard.cred.required"));
          return;
        }
        await api.saveConfig(
          wizardFinishPatch({ adapterId, cwd, model, modelParams, options }),
        );
        onDone();
        return;
      }
      setStep((s) => Math.min(s + 1, steps.length - 1));
    } catch (err) {
      setError(operatorError(err instanceof Error ? err.message : String(err), t));
    } finally {
      setSubmitting(false);
    }
  }

  const last = id === steps[steps.length - 1];

  return (
    <main className="gate wide">
      <div className="gate-corner">
        <label className="locale-switch">
          <span className="visually-hidden">{t("settings.locale")}</span>
          <select
            value={locale}
            aria-label={t("settings.locale")}
            onChange={(e) => {
              const next = e.target.value;
              setLocale(next);
              void api.saveConfig({ space: { locale: next, theme } }).then(onConfig).catch(() => undefined);
            }}
          >
            <option value="en">English</option>
            <option value="es">Español</option>
          </select>
        </label>
        <label className="locale-switch">
          <span className="visually-hidden">{t("settings.theme")}</span>
          <select
            value={theme}
            aria-label={t("settings.theme")}
            onChange={(e) => {
              const next = e.target.value as Theme;
              setTheme(next);
              void api.saveConfig({ space: { locale, theme: next } }).then(onConfig).catch(() => undefined);
            }}
          >
            <option value="dark">{t("settings.theme.dark")}</option>
            <option value="light">{t("settings.theme.light")}</option>
            <option value="system">{t("settings.theme.system")}</option>
          </select>
        </label>
      </div>
      {/* The mark stands above the panel, not inside it as a fourth heading. */}
      <div className="gate-column">
        <div className="gate-brand">
          <GlassysMark size={28} />
          <strong>{t("app.name")}</strong>
        </div>
        <div className="panel">
          {/* Progress is one 2px bar along the panel's top edge; the step's name is
              the heading below it. Five labelled bars plus an eyebrow plus the
              heading were three ways of saying the same thing. */}
          <div
            className="wizard-progress"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={steps.length}
            aria-valuenow={step + 1}
            aria-label={t("wizard.title")}
          >
            <span style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
          </div>
          <div className="panel-heading">
            <p className="eyebrow">
              {t("wizard.title")} · <span className="nums">{step + 1}/{steps.length}</span>
            </p>
            <h2>{t(`wizard.step.${id}`)}</h2>
          </div>

          {id === "adapter" && (
            <div className="stack">
              <p>{t("wizard.adapter.body")}</p>
              {!adaptersReady && <p className="muted">{t("wizard.adapters.loading")}</p>}
              {adaptersError && (
                <Callout
                  tone="danger"
                  action={
                    <button type="button" className="ghost tiny" onClick={() => loadAdapters()}>
                      {t("wizard.adapters.retry")}
                    </button>
                  }
                >
                  {adaptersError}
                </Callout>
              )}
              {adapters.map((a) => {
                const selectable = adapterSelectable(a);
                return (
                  <button
                    key={a.id}
                    type="button"
                    className={`adapter-card${adapterId === a.id ? " current" : ""}${selectable ? "" : " disabled"}`}
                    aria-pressed={adapterId === a.id}
                    disabled={!selectable}
                    onClick={() => setAdapterId(a.id)}
                  >
                    <span className="adapter-mono" aria-hidden="true">
                      {a.displayName.slice(0, 1)}
                    </span>
                    <span className="adapter-card-body">
                      <strong>{a.displayName}</strong>
                      {a.description ? <span className="muted">{a.description}</span> : null}
                      {!selectable && a.available && !a.available.ok && a.available.error ? (
                        <span className="muted adapter-error" title={a.available.error}>
                          {a.available.error}
                        </span>
                      ) : a.id === "acp" && selectable ? (
                        <span className="muted">{t("wizard.acp.needsCommand")}</span>
                      ) : null}
                    </span>
                    <span className="adapter-card-state">
                      {selectable ? (
                        adapterId === a.id ? (
                          <span className="adapter-check">
                            <IconCheck />
                          </span>
                        ) : null
                      ) : (
                        <StatusBadge tone="danger" dot>
                          {t("wizard.adapter.unavailableShort")}
                        </StatusBadge>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {id === "workspace" && (
            <div className="stack">
              <p>{t("wizard.workspace.body")}</p>
              <WorkspacePicker value={cwd} onChange={setCwd} />
            </div>
          )}

          {id === "phone" && <ReachabilityCard />}

          {id === "credential" && (
            <div className="stack">
              <p>{t("wizard.cred.body")}</p>
              <div className="row wrap">
                {caps?.auth.kind === "sdk-login" &&
                  (auth?.loggedIn ? (
                    <StatusBadge tone="ok" dot>
                      {auth.email || t("wizard.cred.signedIn")}
                    </StatusBadge>
                  ) : (
                    <StatusBadge dot>{t("wizard.cred.signedOut")}</StatusBadge>
                  ))}
                {(config.secrets.adapters?.[adapterId]?.apiKey.configured ||
                  (adapterId === "cursor" && config.secrets.cursorApiKey.configured)) && (
                  <StatusBadge tone="ok" dot>
                    {t("wizard.cred.keyConfigured")}
                  </StatusBadge>
                )}
              </div>
              {caps?.auth.kind === "sdk-login" && (
                <SdkLoginControls
                  adapterId={adapterId}
                  onSignedIn={async () => {
                    onConfig(await api.config());
                    await refreshAuth();
                    const r = await api.models(adapterId).catch(() => null);
                    if (r) {
                      setModels(r.models);
                      setModelSource(r.source);
                      setModelError(r.error || "");
                    }
                  }}
                />
              )}
              <p className="muted">
                {caps?.auth.kind === "sdk-login" ? t("wizard.cred.loginHint") : t("wizard.cred.keyHint")}
                {caps?.auth.envNames?.length ? ` ${caps.auth.envNames.join(", ")}` : ""}
              </p>
              {caps?.auth.kind === "sdk-login" &&
                !auth?.loggedIn &&
                !adapterKeyConfigured(config.secrets, adapterId) &&
                !apiKey.trim() && <Callout tone="warn">{t("wizard.cred.unsignedWarn")}</Callout>}
              <details>
                <summary>{t("wizard.cred.optional")}</summary>
                <label>
                  {t("wizard.cred.key")}
                  <input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
                </label>
                <p className="muted">{t("wizard.cred.keyHint")}</p>
              </details>
            </div>
          )}

          {id === "model" && (
            <div className="stack">
              <p>{t("wizard.model.body")}</p>
              <CatalogFallbackNotice liveCatalog={caps?.liveCatalog} source={modelSource} error={modelError} />
              <ModelPicker
                models={models}
                modelId={model}
                params={modelParams}
                preferred={caps?.defaultModel}
                onChange={(nextId, nextParams) => {
                  setModel(nextId);
                  setModelParams(nextParams);
                }}
              />
            </div>
          )}

          {id === "acp" && (
            <div className="stack">
              <p>{t("wizard.acp.body")}</p>
              {discover.length > 0 && (
                <label>
                  {t("wizard.acp.registry")}
                  <select
                    value={optionString(options, "registryId", "")}
                    onChange={(e) => {
                      const item = discover.find((d) => d.id === e.target.value);
                      setOptions({
                        ...options,
                        registryId: e.target.value,
                        command: item?.command || optionString(options, "command", ""),
                        args: item?.args || optionStringArray(options, "args", []),
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
                  value={optionString(options, "command", "")}
                  onChange={(e) => setOptions(setOption(options, "command", e.target.value))}
                  placeholder={t("wizard.acp.commandPlaceholder")}
                />
              </label>
              <label>
                {t("wizard.acp.args")}
                <input
                  value={optionStringArray(options, "args", []).join(" ")}
                  onChange={(e) => setOptions(setOption(options, "args", e.target.value.split(/\s+/).filter(Boolean)))}
                  placeholder={t("wizard.acp.argsPlaceholder")}
                />
              </label>
            </div>
          )}

          {id === "rules" && (
            <div className="stack">
              <p>{t("wizard.rules.body")}</p>
              {(["project", "user", "plugins"] as SettingSource[]).map((s) => (
                <Switch
                  key={s}
                  label={t(`wizard.rules.${s}`)}
                  checked={optionStringArray(options, "settingSources", ["project", "user"]).includes(s)}
                  onChange={(next) => {
                    const cur = optionStringArray(options, "settingSources", ["project", "user"]);
                    setOptions(setOption(options, "settingSources", next ? [...cur, s] : cur.filter((x) => x !== s)));
                  }}
                />
              ))}
            </div>
          )}

          {id === "execution" && (
            <div className="stack">
              <p>{t("wizard.exec.body")}</p>
              {caps?.sandbox && (
                <Switch
                  checked={optionBool(options, "sandbox", false)}
                  label={t("wizard.exec.sandbox")}
                  hint={t("settings.sandboxHint")}
                  onChange={(next) => setOptions(setOption(options, "sandbox", next))}
                />
              )}
              {caps?.autoRun && (
                <Switch
                  checked={optionBool(options, "autoRun", true)}
                  label={t("wizard.exec.autoRun")}
                  hint={t("settings.autoRunHint")}
                  onChange={(next) => setOptions(setAutoRun(options, next, caps?.toolConfirmation))}
                />
              )}
              {caps?.toolConfirmation === "permission-mode" && (
                <label>
                  {t("wizard.exec.permissionMode")}
                  <select
                    value={optionString(options, "permissionMode", "bypassPermissions")}
                    onChange={(e) => setOptions(setPermissionMode(options, e.target.value))}
                  >
                    <option value="bypassPermissions">{t("wizard.exec.permission.bypass")}</option>
                    <option value="dontAsk">{t("wizard.exec.permission.dontAsk")}</option>
                    <option value="acceptEdits">{t("wizard.exec.permission.acceptEdits")}</option>
                  </select>
                </label>
              )}
              {caps?.toolConfirmation === "auto-review-deny" && <Callout tone="warn">{t("wizard.exec.danger")}</Callout>}
              {caps?.toolConfirmation === "none" && <Callout tone="warn">{t("wizard.exec.unattended")}</Callout>}
              {caps?.toolConfirmation === "permission-mode" && <Callout tone="warn">{t("wizard.exec.permission.hint")}</Callout>}
            </div>
          )}

          {error && <Callout tone="danger">{error}</Callout>}
          <div className="row wizard-nav">
            {/* Reserved: Back appearing and disappearing shifted Continue sideways. */}
            <button
              type="button"
              className={`ghost${step === 0 ? " reserved" : ""}`}
              onClick={() => setStep((s) => s - 1)}
              disabled={step === 0}
            >
              {t("wizard.back")}
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => void next()}
              disabled={
                !adaptersReady ||
                adapters.length === 0 ||
                submitting ||
                (id === "credential" &&
                  !wizardCredentialReady({
                    authKind: caps?.auth.kind,
                    loggedIn: auth?.loggedIn,
                    keyConfigured: adapterKeyConfigured(config.secrets, adapterId),
                    apiKeyDraft: apiKey,
                  }))
              }
            >
              {last ? t("wizard.finish") : t("wizard.next")}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
