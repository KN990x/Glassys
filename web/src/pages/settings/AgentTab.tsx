import type {
  AdapterDiscoverItem,
  AdapterPublicInfo,
  ModelCatalogItem,
  ModelListSource,
  RedactedConfig,
  SettingSource,
} from "@glassys/protocol";
import { adapterSelectable } from "@glassys/protocol";
import { api } from "../../api";
import { useT } from "../../i18n";
import { ModelPicker } from "../../components/ModelPicker";
import { CatalogFallbackNotice } from "../../components/CatalogFallback";
import { SdkLoginControls } from "../../components/SdkLogin";
import { WorkspacePicker } from "../../components/WorkspacePicker";
import { optionBool, optionString, optionStringArray, setOption, setAutoRun, setPermissionMode } from "../../adapterOptions";

export function AgentTab({
  draft,
  setDraft,
  adapters,
  setAdapters,
  adaptersError,
  setAdaptersError,
  currentAdapter,
  models,
  modelSource,
  modelError,
  auth,
  setAuth,
  discover,
  apiKey,
  setApiKey,
  clearKey,
  setClearKey,
  keyConfigured,
  keyFromEnv,
  loadModels,
  pickAdapter,
  toggleSource,
}: {
  draft: RedactedConfig;
  setDraft: (next: RedactedConfig) => void;
  adapters: AdapterPublicInfo[];
  setAdapters: (next: AdapterPublicInfo[]) => void;
  adaptersError: string;
  setAdaptersError: (value: string) => void;
  currentAdapter?: AdapterPublicInfo;
  models: ModelCatalogItem[];
  modelSource: ModelListSource;
  modelError: string;
  auth: { loggedIn: boolean; email?: string; apiKeyConfigured: boolean } | null;
  setAuth: (next: { loggedIn: boolean; email?: string; apiKeyConfigured: boolean } | null) => void;
  discover: AdapterDiscoverItem[];
  apiKey: string;
  setApiKey: (value: string) => void;
  clearKey: boolean;
  setClearKey: (value: boolean) => void;
  keyConfigured: boolean;
  keyFromEnv: boolean;
  loadModels: (adapterId: string) => Promise<ModelCatalogItem[]>;
  pickAdapter: (id: string) => void;
  toggleSource: (source: SettingSource, on: boolean) => void;
}) {
  const t = useT();
  const caps = currentAdapter?.capabilities;
  return (
    <>
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
    </>
  );
}
