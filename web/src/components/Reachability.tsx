import { useEffect, useState } from "react";
import { api } from "../api";
import { useT } from "../i18n";
import { QrCode } from "./QrCode";

export function ReachabilityCard() {
  const t = useT();
  const pageOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const [url, setUrl] = useState(pageOrigin);
  const [loopback, setLoopback] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api
      .reachability()
      .then((r) => {
        setLoopback(r.loopback);
        const publicUrl = r.publicUrl?.trim();
        setUrl(publicUrl || pageOrigin);
      })
      .catch(() => undefined);
  }, [pageOrigin]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
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
      <code className="login-url">{url}</code>
      <div className="row wrap">
        <button type="button" className="ghost" onClick={() => void copy()}>
          {copied ? t("chat.copied") : t("reach.copy")}
        </button>
      </div>
      {url && <QrCode value={url} label={t("reach.qr")} />}
    </div>
  );
}
