import { type ReactNode } from "react";
import type { HostCapabilities, HostOverview } from "@glassys/protocol";
import { useT } from "../../i18n";
import { formatBytes, formatUptime } from "../../format";
import { Callout, ListRow, Meter, Skeleton, meterTone } from "../../components/Primitives";
import {
  IconCheck,
  IconClock,
  IconCpu,
  IconDisk,
  IconMemory,
  IconSwap,
  IconZap,
} from "../../components/Icon";
import { HostHead, RefreshButton, UnitState, fill, unitTone, useLoad, type Draft, type HostSource, type HostViewId } from "./shared";

/** Overview: load, memory, disks and the units that failed, at a glance. */

function StatCard({
  glyph,
  label,
  value,
  detail,
  meter,
}: {
  glyph: ReactNode;
  label: string;
  value: string;
  detail?: string;
  meter?: { value: number; max: number };
}) {
  return (
    <div className="stat-card">
      <div className="stat-card-head">
        <span className="stat-card-glyph" aria-hidden="true">
          {glyph}
        </span>
        <span>{label}</span>
      </div>
      <strong className="stat-card-value nums">{value}</strong>
      {/* A card without a bar keeps the bar's row, so every detail line sits
          at the same height across the grid. */}
      {meter ? <Meter value={meter.value} max={meter.max} label={label} /> : <span className="meter-slot" aria-hidden="true" />}
      {detail ? <span className="stat-card-detail nums">{detail}</span> : null}
    </div>
  );
}

/* The dot and one word: a pill beside a dot of the same colour said it twice.
   Only trouble is coloured; a running unit is the normal case. */

export function OverviewView({
  source,
  caps,
  locale,
  onDraft,
  onView,
}: {
  source: HostSource;
  caps: HostCapabilities | null;
  locale: string;
  onDraft: Draft;
  onView: (v: HostViewId) => void;
}) {
  const t = useT();
  const overview = useLoad(() => source.hostOverview(), [source]);
  const failed = useLoad(
    () => (caps?.services ? source.hostServices("system", "failed").then((r) => r.units) : Promise.resolve([])),
    [source, caps?.services],
  );
  const o: HostOverview | null = overview.data;

  return (
    <div className="host-page">
      <HostHead
        title={t("nav.overview")}
        sub={o ? [o.hostname, o.os, o.kernel, o.arch].filter(Boolean).join(" · ") : undefined}
      >
        <RefreshButton
          busy={overview.loading}
          onClick={() => {
            void overview.reload();
            void failed.reload();
          }}
        />
        <button type="button" className="primary" onClick={() => onDraft(t("prompt.draft.review"))}>
          <IconZap />
          {t("host.review")}
        </button>
      </HostHead>

      {overview.error ? <Callout tone="danger">{overview.error}</Callout> : null}
      {!o && overview.loading ? <Skeleton label={t("host.loading")} /> : null}

      {o ? (
        <>
          <div className="stat-grid">
            <StatCard glyph={<IconClock />} label={t("host.uptime")} value={formatUptime(o.uptimeSec)} detail={`${o.cpus} ${t("host.cores")}`} />
            <StatCard
              glyph={<IconCpu />}
              label={t("host.load")}
              value={o.load[0].toFixed(2)}
              detail={`5m ${o.load[1].toFixed(2)} · 15m ${o.load[2].toFixed(2)}`}
              meter={{ value: o.load[0], max: o.cpus }}
            />
            <StatCard
              glyph={<IconMemory />}
              label={t("host.memory")}
              value={`${Math.round((o.mem.used / o.mem.total) * 100)}%`}
              detail={`${formatBytes(o.mem.used, locale)} / ${formatBytes(o.mem.total, locale)}`}
              meter={{ value: o.mem.used, max: o.mem.total }}
            />
            {o.swap ? (
              <StatCard
                glyph={<IconSwap />}
                label={t("host.swap")}
                value={`${Math.round((o.swap.used / o.swap.total) * 100)}%`}
                detail={`${formatBytes(o.swap.used, locale)} / ${formatBytes(o.swap.total, locale)}`}
                meter={{ value: o.swap.used, max: o.swap.total }}
              />
            ) : (
              <StatCard glyph={<IconDisk />} label={t("host.disks")} value={String(o.disks.length)} detail={t("host.mounted")} />
            )}
          </div>

          <section className="host-section">
            <h3 className="section-title">{t("host.disks")}</h3>
            <div className="host-card">
              {o.disks.length === 0 ? <p className="muted host-empty">{t("host.noDisks")}</p> : null}
              {o.disks.map((d) => {
                const ratio = d.size ? d.used / d.size : 0;
                return (
                  <div key={d.fs + d.mount} className="disk-row">
                    <span className="disk-name">
                      <span className="mono truncate">{d.mount}</span>
                      <span className="disk-fs truncate">{d.fs}</span>
                    </span>
                    <Meter value={d.used} max={d.size} label={d.mount} />
                    <span className="disk-figures nums">
                      {formatBytes(d.used, locale)} / {formatBytes(d.size, locale)}
                    </span>
                    <span className={`disk-pct nums tone-${meterTone(ratio)}`}>{Math.round(ratio * 100)}%</span>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      ) : null}

      {caps?.services ? (
        <section className="host-section">
          <div className="host-section-head">
            <h3 className="section-title">{t("host.failedUnits")}</h3>
            <button type="button" className="ghost tiny text-btn" onClick={() => onView("services")}>
              {t("host.seeAll")}
            </button>
          </div>
          <div className="host-card list">
            {failed.error ? <Callout tone="danger">{failed.error}</Callout> : null}
            {failed.data && failed.data.length === 0 ? (
              <p className="host-empty ok-line">
                <IconCheck />
                {t("host.noFailed")}
              </p>
            ) : null}
            {failed.data?.slice(0, 5).map((u) => (
              <ListRow
                key={u.name}
                glyph={<span className={`unit-dot tone-${unitTone(u)}`} />}
                tail={<UnitState unit={u} />}
                onClick={() => onDraft(fill(t("prompt.draft.diagnose"), { unit: u.name, state: u.sub || u.active }))}
                title={t("services.diagnose")}
              >
                <span className="unit-name">{u.name}</span>
                {u.description ? <span className="unit-desc">{u.description}</span> : null}
              </ListRow>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
