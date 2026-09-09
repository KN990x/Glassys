import { api } from "../../api";
import { useT } from "../../i18n";
import { operatorError } from "../../operatorError";
import type { ConfirmRequest } from "../../components/ConfirmDialog";

export type UpdateInfo = {
  version: string;
  protocolVersion: number;
  git?: { sha: string; branch: string; dirty: boolean };
  service: "launchd" | "systemd" | "none";
  upgrading?: { phase: string; error?: string };
};

export function UpdatesTab({
  update,
  setUpdate,
  behind,
  setBehind,
  restartNote,
  setRestartNote,
  setError,
  confirm,
}: {
  update: UpdateInfo | null;
  setUpdate: (next: UpdateInfo | null) => void;
  behind: number | null;
  setBehind: (value: number | null) => void;
  restartNote: string;
  setRestartNote: (value: string) => void;
  setError: (value: string) => void;
  confirm: (req: ConfirmRequest) => Promise<boolean>;
}) {
  const t = useT();
  return (
    <>
      {update && (
        <>
          <p>
            {t("settings.updateVersion")}: {update.version}
            {update.git ? ` · ${update.git.branch} ${update.git.sha.slice(0, 7)}${update.git.dirty ? "*" : ""}` : ""}
          </p>
          <p className="muted">{t("settings.updateService")}: {update.service}</p>
          {behind !== null && (
            <p>
              {behind} {t("settings.updateBehind")}
            </p>
          )}
          {update.upgrading?.phase && update.upgrading.phase !== "idle" && (
            <p className="warn" role="status">
              {update.upgrading.phase === "error"
                ? `${t("settings.updateFailed")} ${update.upgrading.error || ""}`
                : t("settings.updating")}
            </p>
          )}
        </>
      )}
      <div className="row">
        <button
          type="button"
          className="ghost"
          onClick={() => {
            void api
              .adminUpdateCheck()
              .then((r) => setBehind(r.behind))
              .catch((err) => setError(operatorError(err instanceof Error ? err.message : String(err), t)));
          }}
        >
          {t("settings.updateCheck")}
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => {
            void (async () => {
              if (update?.git?.dirty) {
                setError(t("settings.updateDirty"));
                return;
              }
              if (!(await confirm({ message: t("settings.updateConfirm"), confirmLabel: t("confirm.update") })))
                return;
              try {
                await api.upgrade();
                setUpdate(await api.adminUpdate());
              } catch (err) {
                const msg = err instanceof Error ? err.message : "";
                setError(msg.includes("user service") ? t("settings.updateNeedService") : operatorError(msg, t));
              }
            })();
          }}
        >
          {t("settings.updateNow")}
        </button>
        <button
          type="button"
          className="danger"
          onClick={() => {
            setRestartNote(t("settings.restarting"));
            void api.restart().catch((err) => {
              setRestartNote(operatorError(err instanceof Error ? err.message : t("settings.restartFailed"), t));
            });
          }}
        >
          {t("settings.restart")}
        </button>
        {restartNote ? <span className="muted">{restartNote}</span> : null}
      </div>
      {update?.service === "none" && <p className="muted">{t("settings.updateNeedService")}</p>}
    </>
  );
}
