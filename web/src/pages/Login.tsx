import { useState, type FormEvent } from "react";
import { api, setToken } from "../api";
import { useT, type Locale } from "../i18n";
import { LocaleSwitch } from "../components/LocaleSwitch";
import { GlassysMark, IconEye, IconEyeOff } from "../components/Icon";
import { Callout } from "../components/Primitives";

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
  const [reveal, setReveal] = useState(false);
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
      <div className="gate-corner">
        <LocaleSwitch locale={locale} onChange={onLocale} />
      </div>
      <div className="panel">
        {/* The product name is a lockup, not the page's heading: it used to be
            an h1 three points smaller than the h2 under it. */}
        <div className="brand tight">
          <GlassysMark size={22} />
          <strong>{t("app.name")}</strong>
        </div>
        <div className="panel-heading">
          <h2>{t("login.title")}</h2>
          <p className="muted">{t("app.tagline")}</p>
        </div>
        <form onSubmit={submit} className="stack">
          <label>
            {t("login.password")}
            <span className="input-reveal">
              <input
                type={reveal ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="icon-btn sm"
                aria-label={t(reveal ? "login.hide" : "login.reveal")}
                title={t(reveal ? "login.hide" : "login.reveal")}
                onClick={() => setReveal((v) => !v)}
              >
                {reveal ? <IconEyeOff /> : <IconEye />}
              </button>
            </span>
          </label>
          {error && <Callout tone="danger">{error}</Callout>}
          <button className="primary" type="submit" disabled={submitting}>
            {submitting && <span className="spinner sm" aria-hidden="true" />}
            {t("login.submit")}
          </button>
        </form>
      </div>
    </main>
  );
}
