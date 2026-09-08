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
import { defaultOptionsFor, optionBool, optionString, optionStringArray, optionsForAdapter, setOption, adapterKeyConfigured } from "../adapterOptions";

type StepId = "adapter" | "workspace" | "credential" | "model" | "rules" | "execution" | "acp";

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
  const [loginBusy, setLoginBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [discover, setDiscover] = useState<AdapterDiscoverItem[]>([]);
  const [locale, setLocale] = useState(config.space.locale);
  const [theme, setTheme] = useState(config.space.theme);

  const current = adapters.find((a) => a.id === adapterId) ?? adapters[0];
  const caps = current?.capabilities;

  const steps = useMemo<StepId[]>(() => {
    const s: StepId[] = ["adapter", "workspace", "credential", "model"];
    if (caps?.discover) s.push("acp");
    if (caps?.settingSources) s.push("rules");
    if (caps?.sandbox || caps?.autoRun || caps?.toolConfirmation === "permission-mode") s.push("execution");
    return s;
  }, [adapterId, caps]);

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
        await api.saveConfig(
          wizardFinishPatch({ adapterId, cwd, model, modelParams, options }),
        );
        onDone();
        return;
      }
      setStep((s) => Math.min(s + 1, steps.length - 1));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const last = id === steps[steps.length - 1];

  return (
    <main className="gate wide">
      <div className="panel">
        <p className="eyebrow">{t("wizard.title")}</p>
        <h2>{t(`wizard.step.${id}`)}</h2>
        <ol className="steps">
          {steps.map((s, i) => (
            <li
              key={s}
              className={i === step ? "active" : i < step ? "done" : ""}
              aria-current={i === step ? "step" : undefined}
              aria-label={t(`wizard.step.${s}`)}
            />
          ))}
        </ol>

        {id === "adapter" && (
          <div className="stack">
            <p>{t("wizard.adapter.body")}</p>
            <div className="row wrap">
              <label>
                {t("settings.locale")}
                <select
                  value={locale}
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
              <label>
                {t("settings.theme")}
                <select
                  value={theme}
                  onChange={(e) => {
                    const next = e.target.value as Theme;
                    setTheme(next);
                    void api.saveConfig({ space: { locale, theme: next } }).then(onConfig).catch(() => undefined);
                  }}
                >
                  <option value="dark">{t("settings.theme.dark")}</option>
                  <option value="light">{t("settings.theme.light")}</option>
                </select>
              </label>
            </div>
            {!adaptersReady && <p className="muted">{t("wizard.adapters.loading")}</p>}
            {adaptersError && (
              <div className="stack">
                <p className="error-text">{adaptersError}</p>
                <button type="button" className="ghost" onClick={() => loadAdapters()}>
                  {t("wizard.adapters.retry")}
                </button>
              </div>
            )}
            {adapters.map((a) => {
              const selectable = adapterSelectable(a);
              return (
              <label key={a.id} className={selectable ? "choice" : "choice disabled"}>
                <input
                  type="radio"
                  name="adapter"
                  checked={adapterId === a.id}
                  disabled={!selectable}
                  onChange={() => setAdapterId(a.id)}
                />
                <span>
                  {a.displayName}
                  {a.description ? <span className="muted"> — {a.description}</span> : null}
                  {!selectable ? (
                    <span className="warn">
                      {" "}
                      {t("wizard.adapter.unavailable")}
                      {a.available && !a.available.ok && a.available.error ? ` ${a.available.error}` : ""}
                    </span>
                  ) : null}
                </span>
              </label>
              );
            })}
          </div>
        )}

        {id === "workspace" && (
          <div className="stack">
            <p>{t("wizard.workspace.body")}</p>
            <label>
              {t("wizard.workspace.path")}
              <input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="/home/you/src/project" />
            </label>
          </div>
        )}

        {id === "credential" && (
          <div className="stack">
            <p>{t("wizard.cred.body")}</p>
            {auth?.loggedIn ? (
              <p className="ok">
                {t("wizard.cred.signedIn")}
                {auth.email ? ` (${auth.email})` : ""}
              </p>
            ) : (
              <p className="muted">{t("wizard.cred.signedOut")}</p>
            )}
            {(config.secrets.adapters?.[adapterId]?.apiKey.configured ||
              (adapterId === "cursor" && config.secrets.cursorApiKey.configured)) && (
              <p className="ok">{t("wizard.cred.keyConfigured")}</p>
            )}
            {caps?.auth.kind === "sdk-login" && (
              <button
                type="button"
                className="primary"
                disabled={loginBusy}
                onClick={async () => {
                  setError("");
                  setLoginBusy(true);
                  try {
                    await api.adapterLogin(adapterId);
                    onConfig(await api.config());
                    await refreshAuth();
                    const r = await api.models(adapterId).catch(() => null);
                    if (r) {
                      setModels(r.models);
                      setModelSource(r.source);
                      setModelError(r.error || "");
                    }
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                  } finally {
                    setLoginBusy(false);
                  }
                }}
              >
                {loginBusy ? t("wizard.cred.loginBusy") : t("wizard.cred.login")}
              </button>
            )}
            <p className="muted">
              {t("wizard.cred.loginHint")}
              {caps?.auth.envNames?.length ? ` (${caps.auth.envNames.join(", ")})` : ""}
            </p>
            {!auth?.loggedIn && !adapterKeyConfigured(config.secrets, adapterId) && (
              <p className="warn">{t("wizard.cred.unsignedWarn")}</p>
            )}
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
            {modelSource === "fallback" && caps?.liveCatalog !== false && (
              <p className="warn">
                {t("wizard.model.fallback")}
                {modelError ? ` (${modelError})` : ""}
              </p>
            )}
            {modelError && caps?.liveCatalog === false && <p className="warn">{modelError}</p>}
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
                placeholder="npx"
              />
            </label>
            <label>
              {t("wizard.acp.args")}
              <input
                value={optionStringArray(options, "args", []).join(" ")}
                onChange={(e) => setOptions(setOption(options, "args", e.target.value.split(/\s+/).filter(Boolean)))}
                placeholder="-y @anthropic-ai/claude-code --acp"
              />
            </label>
          </div>
        )}

        {id === "rules" && (
          <div className="stack">
            <p>{t("wizard.rules.body")}</p>
            {(["project", "user", "plugins"] as SettingSource[]).map((s) => (
              <label key={s} className="choice">
                <input
                  type="checkbox"
                  checked={optionStringArray(options, "settingSources", ["project", "user"]).includes(s)}
                  onChange={(e) => {
                    const cur = optionStringArray(options, "settingSources", ["project", "user"]);
                    setOptions(setOption(options, "settingSources", e.target.checked ? [...cur, s] : cur.filter((x) => x !== s)));
                  }}
                />
                {t(`wizard.rules.${s}`)}
              </label>
            ))}
          </div>
        )}

        {id === "execution" && (
          <div className="stack">
            <p>{t("wizard.exec.body")}</p>
            {caps?.sandbox && (
              <label className="choice">
                <input
                  type="checkbox"
                  checked={optionBool(options, "sandbox", false)}
                  onChange={(e) => setOptions(setOption(options, "sandbox", e.target.checked))}
                />
                {t("wizard.exec.sandbox")}
              </label>
            )}
            {caps?.autoRun && (
              <label className="choice">
                <input
                  type="checkbox"
                  checked={optionBool(options, "autoRun", true)}
                  onChange={(e) => setOptions(setOption(options, "autoRun", e.target.checked))}
                />
                {t("wizard.exec.autoRun")}
              </label>
            )}
            {caps?.toolConfirmation === "permission-mode" && (
              <label>
                {t("wizard.exec.permissionMode")}
                <select
                  value={optionString(options, "permissionMode", "bypassPermissions")}
                  onChange={(e) => setOptions(setOption(options, "permissionMode", e.target.value))}
                >
                  <option value="bypassPermissions">{t("wizard.exec.permission.bypass")}</option>
                  <option value="dontAsk">{t("wizard.exec.permission.dontAsk")}</option>
                  <option value="acceptEdits">{t("wizard.exec.permission.acceptEdits")}</option>
                </select>
              </label>
            )}
            {caps?.toolConfirmation === "auto-review-deny" && <p className="warn">{t("wizard.exec.danger")}</p>}
            {caps?.toolConfirmation === "none" && <p className="warn">{t("wizard.exec.unattended")}</p>}
            {caps?.toolConfirmation === "permission-mode" && <p className="warn">{t("wizard.exec.permission.hint")}</p>}
          </div>
        )}

        {error && <p className="error-text">{error}</p>}
        <div className="row">
          {step > 0 && (
            <button type="button" className="ghost" onClick={() => setStep((s) => s - 1)}>
              {t("wizard.back")}
            </button>
          )}
          <button type="button" className="primary" onClick={() => void next()} disabled={!adaptersReady || adapters.length === 0 || submitting}>
            {last ? t("wizard.finish") : t("wizard.next")}
          </button>
        </div>
      </div>
    </main>
  );
}
