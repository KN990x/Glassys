import { Suspense, lazy, useEffect, useState } from "react";
import { useCopy } from "../useCopy";
import { api } from "../api";
import { useT } from "../i18n";
import { Callout } from "./Primitives";
import { IconCheck, IconCopy } from "./Icon";

const QrCode = lazy(() => import("./QrCode").then((m) => ({ default: m.QrCode })));

/**
 * How to reach this gateway from a phone. The URL used to render unstyled: the
 * class sat on the <code> itself while the rule targeted a <code> inside it.
 */
export function ReachabilityCard() {
  const t = useT();
  const pageOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const [url, setUrl] = useState(pageOrigin);
  const [loopback, setLoopback] = useState(true);

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

  const { state: copyState, copy: copyText } = useCopy();
  const copied = copyState === "copied";
  const copy = () => copyText(url);

  return (
    <div className="reach">
      <div className="reach-body">
        <p className="muted">{t("reach.body")}</p>
        <div className="login-url">
          <code>{url}</code>
        </div>
        <button type="button" className="ghost" onClick={() => void copy()}>
          {copied ? <IconCheck /> : <IconCopy />}
          {copied ? t("chat.copied") : t("reach.copy")}
        </button>
        {loopback && <Callout tone="warn">{t("reach.loopback")}</Callout>}
      </div>
      {url && (
        <Suspense fallback={null}>
          <QrCode value={url} label={t("reach.qr")} />
        </Suspense>
      )}
    </div>
  );
}
