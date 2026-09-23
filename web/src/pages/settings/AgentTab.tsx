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
import { Callout, SettingGroup, SettingRow, StatusBadge } from "../../components/Primitives";
import { Switch } from "../../components/Switch";
import { SegmentedControl } from "../../components/SegmentedControl";
import { optionBool, optionString, optionStringArray, setOption, setAutoRun, setPermissionMode } from "../../adapterOptions";
import { riskTone } from "../../components/PermissionChip";

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
  const autoRun = optionBool(draft.agent.options, "autoRun", true);
  const sandbox = optionBool(draft.agent.options, "sandbox", false);
  const tone = riskTone({ autoRun, sandbox, sandboxSupported: Boolean(caps?.sandbox) });

  return (
    <>
      {/* One line, in the tone of the thing it warns about, instead of a
          three-sentence orange paragraph above every control. */}
      <Callout tone="warn">{t("settings.newThread")}</Callout>

      <SettingGroup title={t("wizard.step.adapter")} hint={currentAdapter?.description}>
        <SettingRow label={t("wizard.step.adapter")} htmlFor="set-adapter">
          <select id="set-adapter" value={draft.agent.adapter} onChange={(e) => pickAdapter(e.target.value)}>
            {adapters.map((a) => (
              <option key={a.id} value={a.id} disabled={!adapterSelectable(a) && a.id !== draft.agent.adapter}>
                {a.displayName}
              </option>
            ))}
          </select>
        </SettingRow>
      </SettingGroup>

      {currentAdapter && !adapterSelectable(currentAdapter) && currentAdapter.available && !currentAdapter.available.ok && (
        <Callout tone="danger">
          {t("wizard.adapter.unavailable")} {currentAdapter.available.error}
        </Callout>
      )}
      {adaptersError && (
        <Callout
          tone="danger"
          action={
            <button
              type="button"
              className="ghost tiny"
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
          }
        >
          {adaptersError}
        </Callout>
      )}

      <SettingGroup title={t("wizard.step.workspace")} hint={t("settings.workspaceHint")}>
        <SettingRow stack>
          <WorkspacePicker
            value={draft.agent.cwd}
            onChange={(cwd) => setDraft({ ...draft, agent: { ...draft.agent, cwd } })}
          />
        </SettingRow>
      </SettingGroup>

      {caps?.models !== false && (
        <SettingGroup title={t("wizard.step.model")}>
          <SettingRow stack>
            <div className="stack">
              <CatalogFallbackNotice liveCatalog={caps?.liveCatalog} source={modelSource} error={modelError} />
              <ModelPicker
                models={models}
                modelId={draft.agent.model}
                params={draft.agent.modelParams ?? []}
                preferred={caps?.defaultModel}
                onChange={(model, modelParams) => setDraft({ ...draft, agent: { ...draft.agent, model, modelParams } })}
              />
            </div>
          </SettingRow>
        </SettingGroup>
      )}

      <SettingGroup title={t("wizard.step.execution")} hint={t("settings.executionHint")}>
        {caps?.sandbox && (
          <SettingRow label={t("wizard.exec.sandbox")} hint={t("settings.sandboxHint")}>
            <Switch
              hideLabel
              label={t("wizard.exec.sandbox")}
              checked={sandbox}
              onChange={(next) =>
                setDraft({ ...draft, agent: { ...draft.agent, options: setOption(draft.agent.options, "sandbox", next) } })
              }
            />
          </SettingRow>
        )}
        {caps?.autoRun && (
          <SettingRow label={t("wizard.exec.autoRun")} hint={t("settings.autoRunHint")}>
            <Switch
              hideLabel
              label={t("wizard.exec.autoRun")}
              checked={autoRun}
              onChange={(next) =>
                setDraft({
                  ...draft,
                  agent: { ...draft.agent, options: setAutoRun(draft.agent.options, next, caps?.toolConfirmation) },
                })
              }
            />
          </SettingRow>
        )}
        {caps?.toolConfirmation === "permission-mode" && (
          <SettingRow label={t("wizard.exec.permissionMode")} hint={t("wizard.exec.permission.hint")}>
            <SegmentedControl
              size="sm"
              label={t("wizard.exec.permissionMode")}
              value={optionString(draft.agent.options, "permissionMode", "bypassPermissions")}
              onChange={(next) =>
                setDraft({ ...draft, agent: { ...draft.agent, options: setPermissionMode(draft.agent.options, next) } })
              }
              options={[
                { value: "bypassPermissions", label: t("wizard.exec.permission.bypass") },
                { value: "acceptEdits", label: t("wizard.exec.permission.acceptEdits") },
                { value: "dontAsk", label: t("wizard.exec.permission.dontAsk") },
              ]}
            />
          </SettingRow>
        )}
        {caps?.settingSources && (
          <SettingRow label={t("settings.ruleSources")} hint={t("settings.ruleSourcesHint")}>
            <div className="row wrap">
              {(["project", "user", "plugins"] as SettingSource[]).map((source) => {
                const on = optionStringArray(draft.agent.options, "settingSources", ["project", "user"]).includes(source);
                return (
                  <button
                    key={source}
                    type="button"
                    className={`ghost tiny${on ? " current" : ""}`}
                    aria-pressed={on}
                    onClick={() => toggleSource(source, !on)}
                  >
                    {t(`wizard.rules.${source}`)}
                  </button>
                );
              })}
            </div>
          </SettingRow>
        )}
      </SettingGroup>
      {caps?.toolConfirmation === "auto-review-deny" && tone === "danger" && (
        <Callout tone="warn">{t("wizard.exec.danger")}</Callout>
      )}
      {caps?.toolConfirmation === "none" && <Callout tone="warn">{t("wizard.exec.unattended")}</Callout>}

      {caps?.discover && (
        <SettingGroup title={t("wizard.step.acp")}>
          {discover.length > 0 && (
            <SettingRow label={t("wizard.acp.registry")} htmlFor="set-acp-registry">
              <select
                id="set-acp-registry"
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
            </SettingRow>
          )}
          <SettingRow label={t("wizard.acp.command")} htmlFor="set-acp-command">
            <input
              id="set-acp-command"
              value={optionString(draft.agent.options, "command", "")}
              onChange={(e) =>
                setDraft({ ...draft, agent: { ...draft.agent, options: setOption(draft.agent.options, "command", e.target.value) } })
              }
            />
          </SettingRow>
          <SettingRow label={t("wizard.acp.args")} htmlFor="set-acp-args">
            <input
              id="set-acp-args"
              value={optionStringArray(draft.agent.options, "args", []).join(" ")}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  agent: {
                    ...draft.agent,
                    options: setOption(draft.agent.options, "args", e.target.value.split(/\s+/).filter(Boolean)),
                  },
                })
              }
            />
          </SettingRow>
        </SettingGroup>
      )}

      <SettingGroup title={t("wizard.step.credential")}>
        <SettingRow label={t("settings.credStatus")} hint={caps?.auth.envNames?.length ? caps.auth.envNames.join(", ") : undefined}>
          <div className="row wrap">
            {caps?.auth.kind === "sdk-login" &&
              (auth?.loggedIn ? (
                <StatusBadge tone="ok" dot>
                  {auth.email || t("wizard.cred.signedIn")}
                </StatusBadge>
              ) : (
                <StatusBadge dot>{t("wizard.cred.signedOut")}</StatusBadge>
              ))}
            {keyConfigured && <StatusBadge tone="ok" dot>{t("wizard.cred.keyConfigured")}</StatusBadge>}
            {keyFromEnv && <StatusBadge tone="warn" dot>{t("settings.cred.fromEnv")}</StatusBadge>}
          </div>
        </SettingRow>
        {caps?.auth.kind === "sdk-login" && (
          <SettingRow label={t("wizard.cred.login")} hint={t("wizard.cred.loginHint")}>
            <SdkLoginControls
              adapterId={draft.agent.adapter}
              onSignedIn={async () => {
                setAuth(await api.adapterStatus(draft.agent.adapter));
                await loadModels(draft.agent.adapter);
              }}
            />
          </SettingRow>
        )}
        <SettingRow label={t("wizard.cred.rotate")} hint={t("wizard.cred.keyHint")} htmlFor="set-api-key">
          <input
            id="set-api-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </SettingRow>
        {keyConfigured && (
          <SettingRow label={t("wizard.cred.clearKey")} hint={clearKey ? t("settings.clearKeyWarn") : undefined}>
            <button
              type="button"
              className="danger tiny"
              onClick={() => {
                setClearKey(true);
                setApiKey("");
              }}
            >
              {t("wizard.cred.clearKey")}
            </button>
          </SettingRow>
        )}
      </SettingGroup>
    </>
  );
}
