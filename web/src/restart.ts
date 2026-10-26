import { api } from "./api";
import type { ConfirmRequest } from "./components/ConfirmDialog";
import { operatorError } from "./operatorError";

/**
 * Restart the gateway after the operator confirms: a restart ends the run in flight. The one path
 * for every restart control (chat, Settings banner, Updates tab), so none of them skips the ask.
 */
export async function confirmAndRestart(
  t: (key: string) => string,
  confirm: (req: ConfirmRequest) => Promise<boolean>,
  setNote: (note: string) => void,
): Promise<void> {
  const ok = await confirm({
    title: t("confirm.titleRestart"),
    message: t("settings.restartConfirm"),
    confirmLabel: t("confirm.restart"),
    destructive: true,
  });
  if (!ok) return;
  setNote(t("settings.restarting"));
  try {
    await api.restart();
  } catch (err) {
    setNote(operatorError(err instanceof Error ? err.message : t("settings.restartFailed"), t));
  }
}
