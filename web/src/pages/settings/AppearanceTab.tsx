import type { RedactedConfig } from "@glassys/protocol";
import { isTheme } from "@glassys/protocol";
import { useT } from "../../i18n";
import { SettingGroup, SettingRow } from "../../components/Primitives";
import { Switch } from "../../components/Switch";

export function AppearanceTab({
  draft,
  setDraft,
}: {
  draft: RedactedConfig;
  setDraft: (next: RedactedConfig) => void;
}) {
  const t = useT();
  return (
    <>
      <SettingGroup title={t("settings.interface")}>
        <SettingRow label={t("settings.locale")} htmlFor="set-locale">
          <select
            id="set-locale"
            value={draft.space.locale}
            onChange={(e) => setDraft({ ...draft, space: { ...draft.space, locale: e.target.value } })}
          >
            <option value="en">English</option>
            <option value="es">Español</option>
          </select>
        </SettingRow>
        <SettingRow label={t("settings.theme")} htmlFor="set-theme">
          <select
            id="set-theme"
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
        </SettingRow>
        <SettingRow label={t("settings.hostLabel")} hint={t("settings.hostLabelHint")} htmlFor="set-host-label">
          <input
            id="set-host-label"
            value={draft.space.name}
            maxLength={40}
            onChange={(e) => setDraft({ ...draft, space: { ...draft.space, name: e.target.value } })}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t("settings.transcript")} hint={t("settings.transcriptHint")}>
        <SettingRow label={t("settings.thinking")} htmlFor="set-thinking">
          <select
            id="set-thinking"
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
        </SettingRow>
        <SettingRow label={t("settings.diffs")}>
          <Switch
            hideLabel
            label={t("settings.diffs")}
            checked={draft.display.diffPreview}
            onChange={(next) => setDraft({ ...draft, display: { ...draft.display, diffPreview: next } })}
          />
        </SettingRow>
        <SettingRow label={t("settings.shellLines")} htmlFor="set-shell-lines">
          <input
            id="set-shell-lines"
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
        </SettingRow>
      </SettingGroup>
    </>
  );
}
