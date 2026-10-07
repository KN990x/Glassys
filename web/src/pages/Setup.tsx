import { useState, type FormEvent } from "react";
import { api } from "../api";
import { useT, type Locale } from "../i18n";
import { LocaleSwitch } from "../components/LocaleSwitch";
import { GlassysMark } from "../components/Icon";
import { Callout } from "../components/Primitives";
import { operatorError } from "../operatorError";

/** The code from a `?setup=` link the installer printed; read once and dropped from the address bar. */
function takeSetupCodeFromUrl(): string {
  if (typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  const code = url.searchParams.get("setup") ?? "";
  if (code) {
    url.searchParams.delete("setup");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }
  return code;
}

export function Setup({
  onDone,
  locale,
  onLocale,
  needsCode = false,
}: {
  onDone: () => void;
  locale: Locale;
  onLocale: (locale: Locale) => void;
  needsCode?: boolean;
}) {
  const t = useT();
  const [code, setCode] = useState(takeSetupCodeFromUrl);
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
    if (needsCode && !code.trim()) return setError(t("setup.codeMissing"));
    setSubmitting(true);
    setError("");
    try {
      await api.setup(password, needsCode ? code.trim() : undefined);
      try {
        await api.saveConfig({ space: { locale } });
      } catch {
        /* locale is best-effort; wizard can still set it */
      }
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
      <div className="gate-corner">
        <LocaleSwitch locale={locale} onChange={onLocale} />
      </div>
      {/* The mark stands above the panel, not inside it as a fourth heading. */}
      <div className="gate-column">
        <div className="gate-brand">
          <GlassysMark size={28} />
          <strong>{t("app.name")}</strong>
        </div>
        <div className="panel">
          <div className="panel-heading">
            <h2>{t("setup.title")}</h2>
            <p className="muted">{t("setup.body")}</p>
          </div>
          <form onSubmit={submit} className="stack">
            {needsCode && (
              <label>
                {t("setup.code")}
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoComplete="one-time-code"
                  autoCapitalize="characters"
                  spellCheck={false}
                  aria-describedby="setup-code-hint"
                />
                <span id="setup-code-hint" className="muted field-hint">
                  {t("setup.codeHint")}
                </span>
              </label>
            )}
            <label>
              {t("setup.password")}
              <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <label>
              {t("setup.confirm")}
              <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </label>
            {error && <Callout tone="danger">{error}</Callout>}
            <button className="primary" type="submit" disabled={submitting}>
              {submitting && <span className="spinner sm" aria-hidden="true" />}
              {t("setup.submit")}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
