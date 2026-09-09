import type { RedactedConfig } from "@glassys/protocol";
import { isTheme } from "@glassys/protocol";
import { useT } from "../../i18n";

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
    </>
  );
}
