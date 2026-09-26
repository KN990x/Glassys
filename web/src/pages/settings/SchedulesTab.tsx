import { useState } from "react";
import type { RedactedConfig } from "@glassys/protocol";
import { api } from "../../api";
import { useT } from "../../i18n";
import { operatorError } from "../../operatorError";
import { formatRelativeShort } from "../../format";
import { Callout, EmptyRow, SettingGroup, SettingRow, StatusBadge } from "../../components/Primitives";
import { SegmentedControl } from "../../components/SegmentedControl";
import { Switch } from "../../components/Switch";
import { IconClock, IconTrash } from "../../components/Icon";

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
  /* Cron and a single timestamp are exclusive, so they are one choice with two
     shapes rather than two fields that silently clear each other. */
  const [kind, setKind] = useState<"cron" | "once">(scheduleAt ? "once" : "cron");

  return (
    <>
      <SettingGroup title={t("settings.scheduleAdd")} hint={t("settings.schedulesHint")}>
        <SettingRow stack>
          <textarea
            rows={3}
            value={scheduleText}
            aria-label={t("settings.scheduleText")}
            placeholder={t("settings.scheduleText")}
            onChange={(e) => setScheduleText(e.target.value)}
          />
        </SettingRow>
        <SettingRow label={t("settings.scheduleWhen")}>
          <SegmentedControl
            label={t("settings.scheduleWhen")}
            value={kind}
            onChange={(next) => {
              setKind(next);
              if (next === "cron") setScheduleAt("");
              else setScheduleCron("");
            }}
            options={[
              { value: "cron", label: t("settings.scheduleRecurring") },
              { value: "once", label: t("settings.scheduleOnce") },
            ]}
          />
        </SettingRow>
        {kind === "cron" ? (
          <SettingRow label={t("settings.scheduleCron")} hint={scheduleTz ? `${t("settings.scheduleTz")}: ${scheduleTz}` : undefined} htmlFor="set-cron">
            <input
              id="set-cron"
              value={scheduleCron}
              placeholder="0 6 * * *"
              onChange={(e) => {
                setScheduleCron(e.target.value);
                if (e.target.value) setScheduleAt("");
              }}
            />
          </SettingRow>
        ) : (
          <SettingRow label={t("settings.scheduleAt")} hint={scheduleTz ? `${t("settings.scheduleTz")}: ${scheduleTz}` : undefined} htmlFor="set-at">
            <input
              id="set-at"
              type="datetime-local"
              value={scheduleAt}
              onChange={(e) => {
                setScheduleAt(e.target.value);
                if (e.target.value) setScheduleCron("");
              }}
            />
          </SettingRow>
        )}
        <SettingRow hint={t("settings.scheduleCatchUp")}>
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
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t("settings.scheduleList")}>
        {schedules.length === 0 && <EmptyRow glyph={<IconClock />}>{t("settings.scheduleEmpty")}</EmptyRow>}
        {schedules.map((job) => (
          <SettingRow
            key={job.id}
            label={job.text}
            hint={
              <span className="schedule-meta">
                <StatusBadge mono>{job.cron || job.at || "—"}</StatusBadge>
                <span>
                  {t("settings.scheduleNext")}{" "}
                  {job.nextRun ? formatRelativeShort(job.nextRun, Date.now(), draft.space.locale) : "—"}
                </span>
                <span className="truncate">{job.cwd}</span>
                {job.lastError ? <span className="warn truncate">{job.lastError}</span> : null}
              </span>
            }
          >
            <Switch
              hideLabel
              label={t("settings.scheduleEnable")}
              checked={job.enabled}
              onChange={(next) => {
                void api
                  .patchSchedule(job.id, { enabled: next })
                  .then(() => refreshSchedules())
                  .catch((err) => setError(operatorError(err instanceof Error ? err.message : String(err), t)));
              }}
            />
            <button
              type="button"
              className="icon-btn sm danger-hover"
              aria-label={t("settings.promptRemove")}
              title={t("settings.promptRemove")}
              onClick={() => {
                void api
                  .deleteSchedule(job.id)
                  .then(() => refreshSchedules())
                  .catch((err) => setError(operatorError(err instanceof Error ? err.message : String(err), t)));
              }}
            >
              <IconTrash />
            </button>
          </SettingRow>
        ))}
      </SettingGroup>
      {schedules.some((job) => job.lastError) && <Callout tone="warn">{t("settings.scheduleLastError")}</Callout>}
    </>
  );
}
