import { useState, type FormEvent } from "react";
import { api, setToken } from "../api";
import { useT, type Locale } from "../i18n";
import { LocaleSwitch } from "../components/LocaleSwitch";
import { GlassysMark } from "../components/Icon";

export function Login({
  onDone,
  locale,
  onLocale,
}: {
  onDone: () => void;
  locale: Locale;
  onLocale: (locale: Locale) => void;
}) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const { token } = await api.login(password);
      setToken(token);
      try {
        await api.saveConfig({ space: { locale } });
      } catch {
        /* locale is best-effort */
      }
      onDone();
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const network = /failed to fetch|network|load failed|aborterror/i.test(raw) || raw === "Failed to fetch";
      setError(network ? t("login.unreachable") : t("login.error"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="gate">
      <div className="panel">
        <div className="panel-tools panel-tools-corner">
          <LocaleSwitch locale={locale} onChange={onLocale} />
        </div>
        <div className="brand">
          <GlassysMark size={36} />
          <div>
            <h1>{t("app.name")}</h1>
            <p className="muted">{t("app.tagline")}</p>
          </div>
        </div>
        <h2>{t("login.title")}</h2>
        <form onSubmit={submit} className="stack">
          <label>
            {t("login.password")}
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error && <p className="error-text">{error}</p>}
          <button className="primary" type="submit" disabled={submitting}>
            {t("login.submit")}
          </button>
        </form>
      </div>
    </main>
  );
}
