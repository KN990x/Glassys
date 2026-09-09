import type { ReactNode } from "react";
import { useT } from "../i18n";
import { IconAlert, IconClose, IconError, IconInfo } from "./Icon";

export type AlertTone = "error" | "warn" | "info";

export type Alert = {
  id: string;
  tone: AlertTone;
  text: string;
  action?: { label: string; run: () => void };
  onDismiss?: () => void;
  extra?: ReactNode;
};

function Glyph({ tone }: { tone: AlertTone }) {
  if (tone === "error") return <IconError size={16} />;
  if (tone === "warn") return <IconAlert size={16} />;
  return <IconInfo size={16} />;
}

/**
 * Eight separate stacked <p class="banner"> elements used to push the transcript
 * down. They now share one tinted, icon-led stack capped to the content width.
 */
export function AlertStack({ alerts }: { alerts: Alert[] }) {
  const t = useT();
  if (!alerts.length) return null;
  return (
    <div className="alert-stack">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className={`banner alert ${alert.tone}`}
          role={alert.tone === "error" ? "alert" : "status"}
        >
          <span className="alert-icon">
            <Glyph tone={alert.tone} />
          </span>
          <span className="alert-text">
            {alert.text}
            {alert.extra}
          </span>
          {alert.action && (
            <button type="button" className="ghost tiny" onClick={alert.action.run}>
              {alert.action.label}
            </button>
          )}
          {alert.onDismiss && (
            <button
              type="button"
              className="icon-btn sm"
              aria-label={t("alert.dismiss")}
              title={t("alert.dismiss")}
              onClick={alert.onDismiss}
            >
              <IconClose size={15} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
