import { useEffect, useState } from "react";
import { api } from "../api";
import { useT } from "../i18n";
import { QrCode } from "./QrCode";

export function ReachabilityCard() {
  const t = useT();
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const [loopback, setLoopback] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api
      .reachability()
      .then((r) => setLoopback(r.loopback))
      .catch(() => undefined);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(origin);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="stack">
      <p>{t("reach.body")}</p>
      {loopback && <p className="warn">{t("reach.loopback")}</p>}
      <code className="login-url">{origin}</code>
      <div className="row wrap">
        <button type="button" className="ghost" onClick={() => void copy()}>
          {copied ? t("chat.copied") : t("reach.copy")}
        </button>
      </div>
      {origin && <QrCode value={origin} label={t("reach.qr")} />}
    </div>
  );
}
