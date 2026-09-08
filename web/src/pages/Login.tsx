import { useState, type FormEvent } from "react";
import { api, setToken } from "../api";
import { useT, type Locale } from "../i18n";
import { LocaleSwitch } from "../components/LocaleSwitch";

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
      onDone();
    } catch {
      setError(t("login.error"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="gate">
      <div className="panel">
        <div className="brand">
          <img src="/icon.svg" alt="" width={40} height={40} />
          <div>
            <h1>{t("app.name")}</h1>
            <p className="muted">{t("app.tagline")}</p>
          </div>
        </div>
        <LocaleSwitch locale={locale} onChange={onLocale} />
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
