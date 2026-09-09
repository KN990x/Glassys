import type { RedactedConfig } from "@glassys/protocol";
import { api } from "../../api";
import { useT } from "../../i18n";
import { operatorError } from "../../operatorError";

export type ScheduleJob = {
  id: string;
  text: string;
  cwd: string;
  threadId?: string;
  cron?: string;
  at?: string;
  enabled: boolean;
  nextRun: string | null;
  lastRun?: string;
  lastError?: string;
};

export function SchedulesTab({
  draft,
  schedules,
  scheduleTz,
  scheduleText,
  setScheduleText,
  scheduleCron,
  setScheduleCron,
  scheduleAt,
  setScheduleAt,
  currentThreadId,
  refreshSchedules,
  setError,
}: {
  draft: RedactedConfig;
  schedules: ScheduleJob[];
  scheduleTz: string;
  scheduleText: string;
  setScheduleText: (value: string) => void;
  scheduleCron: string;
  setScheduleCron: (value: string) => void;
  scheduleAt: string;
  setScheduleAt: (value: string) => void;
  currentThreadId?: string | null;
  refreshSchedules: () => Promise<void>;
  setError: (value: string) => void;
}) {
  const t = useT();
  return (
    <>
      <p className="muted">{t("settings.schedulesHint")}</p>
      {scheduleTz && (
        <p className="muted">
          {t("settings.scheduleTz")}: {scheduleTz}
        </p>
      )}
      <p className="muted">{t("settings.scheduleCatchUp")}</p>
      <label>
        {t("settings.scheduleText")}
        <textarea rows={3} value={scheduleText} onChange={(e) => setScheduleText(e.target.value)} />
      </label>
      <label>
        {t("settings.scheduleCron")}
        <input
          value={scheduleCron}
          placeholder="0 6 * * *"
          onChange={(e) => {
            setScheduleCron(e.target.value);
            if (e.target.value) setScheduleAt("");
          }}
        />
      </label>
      <label>
        {t("settings.scheduleAt")}
        <input
          type="datetime-local"
          value={scheduleAt}
          onChange={(e) => {
            setScheduleAt(e.target.value);
            if (e.target.value) setScheduleCron("");
          }}
        />
      </label>
      <button
        type="button"
        className="ghost"
        onClick={() => {
          void (async () => {
            try {
              await api.createSchedule({
                text: scheduleText,
                cwd: draft.agent.cwd,
                threadId: currentThreadId || undefined,
                cron: scheduleCron.trim() || undefined,
                at: scheduleAt ? new Date(scheduleAt).toISOString() : undefined,
              });
              setScheduleText("");
              setScheduleCron("");
              setScheduleAt("");
              await refreshSchedules();
            } catch (err) {
              setError(operatorError(err instanceof Error ? err.message : String(err), t));
            }
          })();
        }}
      >
        {t("settings.scheduleAdd")}
      </button>
      {schedules.length === 0 && <p className="muted">{t("settings.scheduleEmpty")}</p>}
      <ul className="schedule-list">
        {schedules.map((job) => (
          <li key={job.id}>
            <p>{job.text}</p>
            <p className="muted">
              {job.cron || job.at} · {t("settings.scheduleNext")} {job.nextRun || "—"} · {job.cwd}
            </p>
            {job.lastRun && (
              <p className="muted">
                {t("settings.scheduleLast")}: {job.lastRun}
              </p>
            )}
            {job.lastError && (
              <p className="warn">
                {t("settings.scheduleLastError")}: {job.lastError}
              </p>
            )}
            <label className="choice">
              <input
                type="checkbox"
                checked={job.enabled}
                onChange={(e) => {
                  void api
                    .patchSchedule(job.id, { enabled: e.target.checked })
                    .then(() => refreshSchedules())
                    .catch((err) => setError(operatorError(err instanceof Error ? err.message : String(err), t)));
                }}
              />
              {t("settings.scheduleEnable")}
            </label>
            <button
              type="button"
              className="ghost tiny"
              onClick={() => {
                void api
                  .deleteSchedule(job.id)
                  .then(() => refreshSchedules())
                  .catch((err) => setError(operatorError(err instanceof Error ? err.message : String(err), t)));
              }}
            >
              {t("settings.promptRemove")}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
