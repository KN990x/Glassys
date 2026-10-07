import { LOCALES, isLocale, useT, type Locale } from "../i18n";

/** The compact language picker of the gate screens (setup, login, wizard). */
export function LocaleSwitch({
  locale,
  onChange,
}: {
  locale: Locale;
  onChange: (locale: Locale) => void;
}) {
  const t = useT();
  return (
    <label className="locale-switch">
      <span className="visually-hidden">{t("settings.locale")}</span>
      <select value={locale} aria-label={t("settings.locale")} onChange={(e) => onChange(isLocale(e.target.value) ? e.target.value : "en")}>
        {LOCALES.map((l) => (
          <option key={l.value} value={l.value}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}
