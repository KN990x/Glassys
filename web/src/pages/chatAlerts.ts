import { PROTOCOL_VERSION } from "@glassys/protocol";
import type { Alert } from "../components/AlertStack";

type Dismissable = { text: string; dismiss: () => void };

/** What the chat's alert stack shows, most serious first. Pure, so the order is testable. */
export function chatAlerts(input: {
  t: (key: string) => string;
  protocolError: number | null;
  configError: string;
  newVersion: boolean;
  /** Set while the loopback warning applies and was not dismissed for this tab. */
  loopback?: { dismiss: () => void };
  adaptersFailed?: { retry: () => void };
  restartRequired: boolean;
  restartNote: string;
  onRestart: () => void;
  send?: Dismissable;
  notice?: Dismissable & { level: "error" | "warn" };
  attach?: Dismissable;
  model?: Dismissable;
}): Alert[] {
  const { t } = input;
  const alerts: Alert[] = [];
  if (input.protocolError !== null) {
    alerts.push({
      id: "protocol",
      tone: "error",
      text: `${t("protocol.incompatible")} (${t("protocol.expected")} ${PROTOCOL_VERSION}, ${t("protocol.got")} ${input.protocolError})`,
    });
  }
  if (input.configError) alerts.push({ id: "config", tone: "error", text: input.configError });
  if (input.newVersion) {
    alerts.push({
      id: "new-version",
      tone: "info",
      text: t("settings.updateReloadNote"),
      action: { label: t("settings.updateReload"), run: () => window.location.reload() },
    });
  }
  if (input.loopback) alerts.push({ id: "loopback", tone: "warn", text: t("reach.loopback"), onDismiss: input.loopback.dismiss });
  if (input.adaptersFailed) {
    alerts.push({
      id: "adapters",
      tone: "error",
      text: t("chat.adaptersFailed"),
      action: { label: t("chat.adaptersRetry"), run: input.adaptersFailed.retry },
    });
  }
  if (input.restartRequired) {
    alerts.push({
      id: "restart",
      tone: "warn",
      text: input.restartNote ? `${t("settings.restartRequired")} ${input.restartNote}` : t("settings.restartRequired"),
      action: { label: t("settings.restart"), run: input.onRestart },
    });
  } else if (input.restartNote) {
    alerts.push({ id: "restart-note", tone: "info", text: input.restartNote });
  }
  if (input.send) alerts.push({ id: "send", tone: "error", text: input.send.text, onDismiss: input.send.dismiss });
  if (input.notice) {
    alerts.push({ id: "notice", tone: input.notice.level, text: input.notice.text, onDismiss: input.notice.dismiss });
  }
  if (input.attach) alerts.push({ id: "attach", tone: "error", text: input.attach.text, onDismiss: input.attach.dismiss });
  if (input.model) alerts.push({ id: "model", tone: "error", text: input.model.text, onDismiss: input.model.dismiss });
  return alerts;
}
