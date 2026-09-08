import { useState, type FormEvent } from "react";
import { api, setToken } from "../api";
import { useT, type Locale } from "../i18n";
import { LocaleSwitch } from "../components/LocaleSwitch";
import { operatorError } from "../operatorError";

export function Setup({
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
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (password.length < 8) return setError(t("setup.short"));
    if (password.length > 256) return setError(t("setup.long"));
    if (password !== confirm) return setError(t("setup.mismatch"));
    setSubmitting(true);
    setError("");
    try {
      const { token } = await api.setup(password);
      setToken(token);
      onDone();
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const mapped = operatorError(raw, t);
      setError(mapped === raw ? t("setup.error") : mapped);
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
        <h2>{t("setup.title")}</h2>
        <p className="muted">{t("setup.body")}</p>
        <form onSubmit={submit} className="stack">
          <label>
            {t("setup.password")}
            <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <label>
            {t("setup.confirm")}
            <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </label>
          {error && <p className="error-text">{error}</p>}
          <button className="primary" type="submit" disabled={submitting}>
            {t("setup.submit")}
          </button>
        </form>
      </div>
    </main>
  );
}
