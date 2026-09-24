import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { formatElapsed } from "../format";
import { Kbd } from "./Primitives";

function Elapsed({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <span className="nums">{formatElapsed(now - startedAt)}</span>;
}

/** The composer's first row while a run is in flight: working, for how long, on what. */
export function RunStatus({
  startedAt,
  step,
  canCancel,
}: {
  startedAt?: number | null;
  step?: string;
  canCancel: boolean;
}) {
  const t = useT();
  return (
    <div className="composer-status" aria-live="polite">
      <span className="pulse" aria-hidden />
      <span className="status-shimmer">{t("status.running")}</span>
      {startedAt ? (
        <span className="muted">
          <Elapsed startedAt={startedAt} />
        </span>
      ) : null}
      {step ? <span className="muted truncate status-step">{step}</span> : null}
      {canCancel ? (
        <span className="muted status-esc">
          <Kbd>Esc</Kbd> {t("chat.cancel")}
        </span>
      ) : null}
    </div>
  );
}
