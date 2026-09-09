import type { AdapterCapabilities, RedactedConfig } from "@glassys/protocol";
import { useT } from "../../i18n";

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
      <div className="row wrap">
        <button type="button" className="ghost" onClick={onLogout}>
          {t("settings.logout")}
        </button>
      </div>
    </>
  );
}
