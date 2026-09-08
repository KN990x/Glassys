import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useT } from "../i18n";

const POLL_MS = 1_500;
const POLL_MAX_MS = 5 * 60_000;

export function SdkLoginControls({
  adapterId,
  onSignedIn,
}: {
  adapterId: string;
  onSignedIn: () => Promise<void> | void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const onSignedInRef = useRef(onSignedIn);
  onSignedInRef.current = onSignedIn;

  useEffect(() => {
    if (!busy) return;
    let stop = false;
    const started = Date.now();
    async function tick() {
      try {
        const status = await api.adapterStatus(adapterId);
        if (stop) return;
        if (status.loginUrl && status.loginUrl !== url) setUrl(status.loginUrl);
        if (status.loggedIn) {
          setBusy(false);
          setUrl("");
          await onSignedInRef.current();
          return;
        }
        if (status.loginStatus === "error") {
          setBusy(false);
          setError(status.loginError || t("wizard.cred.loginFailed"));
          return;
        }
        if (status.loginStatus === "cancelled") {
          setBusy(false);
          return;
        }
        if (Date.now() - started > POLL_MAX_MS) {
          setBusy(false);
          setError(t("wizard.cred.loginTimeout"));
        }
      } catch (err) {
        if (!stop) setError(err instanceof Error ? err.message : String(err));
      }
    }
    const id = setInterval(() => void tick(), POLL_MS);
    void tick();
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [adapterId, busy, t, url]);

  async function start() {
    setError("");
    setCopied(false);
    setBusy(true);
    try {
      const result = await api.adapterLogin(adapterId);
      if (result.url) setUrl(result.url);
      const status = await api.adapterStatus(adapterId);
      if (status.loggedIn) {
        setBusy(false);
        setUrl("");
        await onSignedInRef.current();
      }
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function cancel() {
    try {
      await api.adapterLoginCancel();
    } catch {
      /* ignore */
    }
    setBusy(false);
  }

  async function copyUrl() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
      setError(t("chat.copyFailed"));
    }
  }

  return (
    <div className="stack">
      <div className="row wrap">
        <button type="button" className="primary" disabled={busy} onClick={() => void start()}>
          {busy ? t("wizard.cred.loginBusy") : t("wizard.cred.login")}
        </button>
        {busy && (
          <button type="button" className="ghost" onClick={() => void cancel()}>
            {t("wizard.cred.loginCancel")}
          </button>
        )}
      </div>
      {url && (
        <div className="login-url">
          <p className="muted">{t("wizard.cred.loginUrl")}</p>
          <code>{url}</code>
          <div className="row wrap">
            <a className="ghost" href={url} target="_blank" rel="noreferrer">
              {t("wizard.cred.openUrl")}
            </a>
            <button type="button" className="ghost" onClick={() => void copyUrl()}>
              {copied ? t("chat.copied") : t("wizard.cred.copyUrl")}
            </button>
          </div>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
