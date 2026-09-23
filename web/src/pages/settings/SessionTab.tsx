import type { AdapterCapabilities, RedactedConfig } from "@glassys/protocol";
import { useT } from "../../i18n";
import { Callout, SettingGroup, SettingRow } from "../../components/Primitives";
import { Switch } from "../../components/Switch";

export function SessionTab({
  draft,
  setDraft,
  caps,
  password,
  setPassword,
  notifyNote,
  enableNotify,
  onLogout,
}: {
  draft: RedactedConfig;
  setDraft: (next: RedactedConfig) => void;
  caps?: AdapterCapabilities;
  password: string;
  setPassword: (value: string) => void;
  notifyNote: string;
  enableNotify: (on: boolean) => Promise<void>;
  onLogout: () => void;
}) {
  const t = useT();
  return (
    <>
      <SettingGroup title={t("settings.runs")}>
        {caps?.resume && (
          <SettingRow label={t("settings.resume")}>
            <Switch
              hideLabel
              label={t("settings.resume")}
              checked={draft.session.resumeOnStart}
              onChange={(next) => setDraft({ ...draft, session: { ...draft.session, resumeOnStart: next } })}
            />
          </SettingRow>
        )}
        <SettingRow label={t("settings.stall")} htmlFor="set-stall">
          <select
            id="set-stall"
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
        </SettingRow>
        <SettingRow label={t("settings.notify")} hint={t("settings.notifyHint")}>
          <Switch
            hideLabel
            label={t("settings.notify")}
            checked={draft.session.notifyOnComplete}
            onChange={(next) => void enableNotify(next)}
          />
        </SettingRow>
      </SettingGroup>
      {notifyNote && <Callout tone="warn">{notifyNote}</Callout>}

      <SettingGroup title={t("settings.security")}>
        <SettingRow label={t("settings.password")} hint={t("settings.passwordHint")} htmlFor="set-password">
          <input
            id="set-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </SettingRow>
        <SettingRow label={t("settings.logout")} hint={t("settings.logoutHint")}>
          <button type="button" className="ghost" onClick={onLogout}>
            {t("settings.logout")}
          </button>
        </SettingRow>
      </SettingGroup>
    </>
  );
}
