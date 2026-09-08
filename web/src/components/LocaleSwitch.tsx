import type { Locale } from "../i18n";
import { useT } from "../i18n";

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
      {t("settings.locale")}
      <select value={locale} onChange={(e) => onChange(e.target.value === "es" ? "es" : "en")}>
        <option value="en">English</option>
        <option value="es">Español</option>
      </select>
    </label>
  );
}
