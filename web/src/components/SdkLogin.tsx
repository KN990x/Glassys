import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useT } from "../i18n";
import { Callout } from "./Primitives";

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
  const tRef = useRef(t);
  tRef.current = t;
  /*
   * "starting" while the login request is out, "waiting" once the gateway started it. Polling only
   * in "waiting": started earlier, it read the previous attempt's cancelled or failed status and
   * stopped the new login at once.
   */
  const [phase, setPhase] = useState<"idle" | "starting" | "waiting">("idle");
  const busy = phase !== "idle";
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const onSignedInRef = useRef(onSignedIn);
  onSignedInRef.current = onSignedIn;
  /* One per Sign in press: a cancelled attempt's late reply must not move the next one along. */
  const attempt = useRef(0);
  const startedAt = useRef(0);

  useEffect(() => {
    if (phase !== "waiting") return;
    let stop = false;
    async function tick() {
      try {
        const status = await api.adapterStatus(adapterId);
        if (stop) return;
        if (status.loginUrl) setUrl(status.loginUrl);
        if (status.loggedIn) {
          setPhase("idle");
          setUrl("");
          await onSignedInRef.current();
          return;
        }
        if (status.loginStatus === "error") {
          setPhase("idle");
          setError(status.loginError || tRef.current("wizard.cred.loginFailed"));
          return;
        }
        if (status.loginStatus === "cancelled") {
          setPhase("idle");
          return;
        }
        if (Date.now() - startedAt.current > POLL_MAX_MS) {
          setPhase("idle");
          setError(tRef.current("wizard.cred.loginTimeout"));
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
  }, [adapterId, phase]);

  async function start() {
    const mine = ++attempt.current;
    setError("");
    setCopied(false);
    setUrl("");
    setPhase("starting");
    startedAt.current = Date.now();
    try {
      const result = await api.adapterLogin(adapterId);
      if (mine !== attempt.current) return;
      if (result.url) setUrl(result.url);
      const status = await api.adapterStatus(adapterId);
      if (mine !== attempt.current) return;
      if (status.loggedIn) {
        setPhase("idle");
        setUrl("");
        await onSignedInRef.current();
        return;
      }
      setPhase("waiting");
    } catch (err) {
      if (mine !== attempt.current) return;
      setPhase("idle");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function cancel() {
    attempt.current += 1;
    try {
      await api.adapterLoginCancel();
    } catch {
      /* ignore */
    }
    setPhase("idle");
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
      {error && <Callout tone="danger">{error}</Callout>}
    </div>
  );
}
