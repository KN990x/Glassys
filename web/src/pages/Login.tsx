import { useState, type FormEvent } from "react";
import { ApiError, api } from "../api";
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
  /* Only a language picked here is the operator's choice; the browser's default must not
     overwrite the instance's language for every device. */
  const [pickedLocale, setPickedLocale] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await api.login(password);
      if (pickedLocale) {
        try {
          await api.saveConfig({ space: { locale } });
        } catch {
          /* locale is best-effort */
        }
      }
      onDone();
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const network = /failed to fetch|network|load failed|aborterror/i.test(raw) || raw === "Failed to fetch";
      if (network) setError(t("login.unreachable"));
      else if (err instanceof ApiError && err.status === 429) setError(t("error.tooManyAttempts"));
      else setError(t("login.error"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="gate">
      <div className="gate-corner">
        <LocaleSwitch
          locale={locale}
          onChange={(next) => {
            setPickedLocale(true);
            onLocale(next);
          }}
        />
      </div>
      {/* The mark stands above the panel, not inside it as a fourth heading. */}
      <div className="gate-column">
        <div className="gate-brand">
          <GlassysMark size={28} />
          <strong>{t("app.name")}</strong>
        </div>
        <div className="panel">
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
      </div>
    </main>
  );
}
