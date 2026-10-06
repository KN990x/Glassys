import { api } from "../../api";
import { useT } from "../../i18n";
import { operatorError } from "../../operatorError";
import type { ConfirmRequest } from "../../components/ConfirmDialog";
import { Callout, SettingGroup, SettingRow, StatusBadge } from "../../components/Primitives";

export type UpdateInfo = {
  version: string;
  protocolVersion: number;
  git?: { sha: string; branch: string; dirty: boolean };
  /** The commit this gateway process started on; `git` is the clone on disk. */
  running?: { commit?: string; startedAt: string };
  service: "launchd" | "systemd" | "none";
  upgrading?: { phase: string; error?: string };
};

/** The gateway commit this page was loaded against. A different one later means stale assets. */
let pageCommit: string | undefined;

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
  const upgrading = update?.upgrading?.phase && update.upgrading.phase !== "idle";
  const runningCommit = update?.running?.commit;
  if (runningCommit && !pageCommit) pageCommit = runningCommit;
  const reloadNeeded = Boolean(runningCommit && pageCommit && runningCommit !== pageCommit);
  const restartPending = Boolean(runningCommit && update?.git?.sha && runningCommit !== update.git.sha);
  return (
    <>
      {reloadNeeded && (
        <Callout
          tone="accent"
          action={
            <button type="button" className="primary" onClick={() => window.location.reload()}>
              {t("settings.updateReload")}
            </button>
          }
        >
          {t("settings.updateReloadNote")}
        </Callout>
      )}
      <SettingGroup title={t("settings.updateVersionGroup")}>
        <SettingRow label={t("settings.updateVersion")}>
          <div className="row wrap">
            {update?.version ? <StatusBadge mono>{update.version}</StatusBadge> : <span className="muted">—</span>}
            {update?.git && (
              <StatusBadge mono tone={update.git.dirty ? "warn" : "neutral"}>
                {update.git.branch}@{update.git.sha.slice(0, 7)}
                {update.git.dirty ? "*" : ""}
              </StatusBadge>
            )}
          </div>
        </SettingRow>
        <SettingRow
          label={t("settings.updateRunning")}
          hint={restartPending && !upgrading ? t("settings.updateRestartPendingHint") : undefined}
        >
          <div className="row wrap">
            {runningCommit ? <StatusBadge mono>{runningCommit.slice(0, 7)}</StatusBadge> : <span className="muted">—</span>}
            {restartPending && !upgrading && (
              <StatusBadge tone="warn" dot>
                {t("settings.updateRestartPending")}
              </StatusBadge>
            )}
          </div>
        </SettingRow>
        <SettingRow label={t("settings.updateService")} hint={update?.service === "none" ? t("settings.updateNeedService") : undefined}>
          {/* A missing figure is a dash in ink, not an empty pill. */}
          {update?.service ? (
            <StatusBadge tone={update.service === "none" ? "warn" : "neutral"} dot={update.service === "none"}>
              {update.service}
            </StatusBadge>
          ) : (
            <span className="muted">—</span>
          )}
        </SettingRow>
        <SettingRow label={t("settings.updateBehind")}>
          <div className="row wrap">
            {behind !== null && (
              <StatusBadge tone={behind > 0 ? "accent" : "neutral"}>
                <span className="nums">{behind}</span>
              </StatusBadge>
            )}
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
          </div>
        </SettingRow>
      </SettingGroup>

      {upgrading && (
        <Callout tone={update?.upgrading?.phase === "error" ? "danger" : "accent"}>
          {update?.upgrading?.phase === "error"
            ? `${t("settings.updateFailed")} ${update.upgrading.error || ""}`
            : t("settings.updating")}
        </Callout>
      )}

      <SettingGroup title={t("settings.updateActions")}>
        <SettingRow label={t("settings.upgradeRow")} hint={update?.git?.dirty ? t("settings.updateDirty") : t("settings.upgradeHint")}>
          <button
            type="button"
            className="primary"
            onClick={() => {
              void (async () => {
                if (update?.git?.dirty) {
                  setError(t("settings.updateDirty"));
                  return;
                }
                if (!(await confirm({ title: t("confirm.titleUpdate"), message: t("settings.updateConfirm"), confirmLabel: t("confirm.update") }))) return;
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
        </SettingRow>
        <SettingRow label={t("settings.restartRow")} hint={restartNote || t("settings.restartHint")}>
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
        </SettingRow>
      </SettingGroup>
    </>
  );
}
