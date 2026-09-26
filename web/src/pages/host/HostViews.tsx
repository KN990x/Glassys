import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  DirListing,
  FileEntry,
  FilePreview,
  HostCapabilities,
  HostOverview,
  LogEntry,
  LogPriority,
  ServiceScope,
  ServiceStateFilter,
  ServiceUnit,
} from "@glassys/protocol";
import { api } from "../../api";
import { useT } from "../../i18n";
import { formatBytes, formatLogTime, formatRelativeShort, formatUptime } from "../../format";
import { operatorError } from "../../operatorError";
import { Callout, ListRow, Meter, Skeleton, meterTone, type Tone } from "../../components/Primitives";
import { SegmentedControl } from "../../components/SegmentedControl";
import { Switch } from "../../components/Switch";
import {
  IconArrowUp,
  IconCheck,
  IconChevronLeft,
  IconClock,
  IconCopy,
  IconCpu,
  IconDisk,
  IconFile,
  IconFileCode,
  IconFolder,
  IconGauge,
  IconLogs,
  IconMemory,
  IconMention,
  IconRefresh,
  IconRestart,
  IconSearch,
  IconServices,
  IconSwap,
  IconZap,
} from "../../components/Icon";

/*
 * Host views: what a code UI shows as Files and Git, in systems terms. They
 * observe; every action drafts a prompt into the composer and returns to the
 * chat, so the agent — with its sandbox and auto-run settings — is still the
 * only thing that changes the machine.
 */

export type HostViewId = "overview" | "services" | "logs" | "files";

/** Where the views read from. The app passes the gateway; the gallery a fake. */
export type HostSource = Pick<typeof api, "hostOverview" | "hostServices" | "hostLogs" | "hostFiles" | "hostFile">;

type Draft = (text: string) => void;

function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const t = useT();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await load());
      setError("");
    } catch (err) {
      setError(operatorError(err instanceof Error ? err.message : t("host.loadFailed"), t));
    } finally {
      setLoading(false);
    }
  }, deps);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload };
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? "");
}

function HostHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="host-head">
      <div className="host-head-text">
        <h2 className="truncate">{title}</h2>
        {sub ? <p className="host-sub truncate">{sub}</p> : null}
      </div>
      {children ? <div className="host-head-actions">{children}</div> : null}
    </header>
  );
}

function RefreshButton({ onClick, busy }: { onClick: () => void; busy?: boolean }) {
  const t = useT();
  return (
    <button
      type="button"
      className={`icon-btn${busy ? " spinning" : ""}`}
      onClick={onClick}
      aria-label={t("host.refresh")}
      title={t("host.refresh")}
    >
      <IconRefresh />
    </button>
  );
}

// ---------------------------------------------------------------- overview

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
function UnitState({ unit }: { unit: ServiceUnit }) {
  return <span className={`unit-state tone-${unitTone(unit)}`}>{unit.sub || unit.active}</span>;
}

function unitTone(u: ServiceUnit): Tone {
  if (u.active === "failed") return "danger";
  if (u.active === "active") return "ok";
  if (u.active === "activating" || u.active === "deactivating" || u.active === "reloading") return "warn";
  return "neutral";
}

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
            <h3 className="eyebrow">{t("host.disks")}</h3>
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
            <h3 className="eyebrow">{t("host.failedUnits")}</h3>
            <button type="button" className="ghost tiny" onClick={() => onView("services")}>
              {t("host.seeAll")}
            </button>
          </div>
          <div className="host-card list">
            {failed.error ? <p className="muted host-empty">{failed.error}</p> : null}
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

// ---------------------------------------------------------------- services

export function ServicesView({
  source,
  caps,
  onDraft,
  onLogs,
}: {
  source: HostSource;
  caps: HostCapabilities | null;
  onDraft: Draft;
  onLogs: (unit: string) => void;
}) {
  const t = useT();
  const [state, setState] = useState<ServiceStateFilter>("all");
  const [scope, setScope] = useState<ServiceScope>("system");
  const [q, setQ] = useState("");
  const [openUnit, setOpenUnit] = useState<string | null>(null);
  const services = useLoad(
    () => (caps?.services ? source.hostServices(scope, state).then((r) => r.units) : Promise.resolve([])),
    [source, scope, state, caps?.services],
  );
  const needle = q.trim().toLowerCase();
  const units = (services.data ?? []).filter(
    (u) => !needle || u.name.toLowerCase().includes(needle) || u.description.toLowerCase().includes(needle),
  );
  const failedCount = (services.data ?? []).filter((u) => u.active === "failed").length;

  if (caps && !caps.services) {
    return (
      <div className="host-page">
        <HostHead title={t("nav.services")} />
        <Callout>{t("host.servicesUnavailable")}</Callout>
      </div>
    );
  }

  return (
    <div className="host-page">
      <HostHead
        title={t("nav.services")}
        sub={
          services.data ? (
            <>
              <span className="nums">{services.data.length}</span> {t("services.count")}
              {failedCount ? (
                <>
                  {" · "}
                  <span className="danger-text">
                    <span className="nums">{failedCount}</span> {t("services.failedCount")}
                  </span>
                </>
              ) : null}
            </>
          ) : undefined
        }
      >
        <RefreshButton busy={services.loading} onClick={() => void services.reload()} />
      </HostHead>

      <div className="host-toolbar">
        <SegmentedControl
          label={t("nav.services")}
          value={state}
          onChange={setState}
          options={[
            { value: "all", label: t("services.all") },
            { value: "active", label: t("services.active") },
            { value: "failed", label: t("services.failed") },
          ]}
        />
        {caps?.services === "systemd" ? (
          <SegmentedControl
            label={t("services.scope")}
            value={scope}
            onChange={setScope}
            options={[
              { value: "system", label: t("services.system") },
              { value: "user", label: t("services.user") },
            ]}
          />
        ) : null}
        <label className="search-field host-search">
          <span className="visually-hidden">{t("services.filter")}</span>
          <IconSearch />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("services.filter")} />
        </label>
      </div>

      {services.error ? <Callout tone="danger">{services.error}</Callout> : null}
      {!services.data && services.loading ? <Skeleton rows={6} label={t("host.loading")} /> : null}
      {services.data ? (
        <div className="host-card list">
          {units.length === 0 ? <p className="muted host-empty">{t("services.empty")}</p> : null}
          {/* Tapping a unit opens its actions under it: the same gesture with a
              pointer or a thumb, where hover-only buttons did not exist on a
              phone. */}
          {units.map((u) => (
            <div key={u.name} className={`unit-item${openUnit === u.name ? " open" : ""}`}>
              <ListRow
                className="unit-row"
                glyph={<span className={`unit-dot tone-${unitTone(u)}`} />}
                tail={<UnitState unit={u} />}
                title={u.description || u.name}
                current={openUnit === u.name}
                onClick={() => setOpenUnit((cur) => (cur === u.name ? null : u.name))}
              >
                <span className="unit-name">{u.name}</span>
                {u.description ? <span className="unit-desc">{u.description}</span> : null}
              </ListRow>
              {openUnit === u.name ? (
                <div className="unit-actions">
                  <button type="button" className="ghost tiny" onClick={() => onLogs(u.name)}>
                    <IconLogs />
                    {t("services.logs")}
                  </button>
                  <button
                    type="button"
                    className="ghost tiny"
                    onClick={() => onDraft(fill(t("prompt.draft.diagnose"), { unit: u.name, state: u.sub || u.active }))}
                  >
                    <IconZap />
                    {t("services.diagnose")}
                  </button>
                  <button
                    type="button"
                    className="ghost tiny"
                    onClick={() => onDraft(fill(t("prompt.draft.restart"), { unit: u.name }))}
                  >
                    <IconRestart />
                    {t("services.restart")}
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- logs

const FOLLOW_MS = 5_000;
/** Lines kept while following; older ones scroll off the top. */
export const MAX_LOG_ROWS = 5_000;

function priorityClass(p: number): string {
  if (p <= 3) return "err";
  if (p === 4) return "warn";
  return "";
}

export function LogsView({
  source,
  caps,
  locale,
  unit,
  onUnit,
  onDraft,
}: {
  source: HostSource;
  caps: HostCapabilities | null;
  locale: string;
  unit: string;
  onUnit: (unit: string) => void;
  onDraft: Draft;
}) {
  const t = useT();
  const [priority, setPriority] = useState<LogPriority | "all">("all");
  const [follow, setFollow] = useState(false);
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const cursor = useRef<string | undefined>(undefined);
  const listRef = useRef<HTMLDivElement>(null);
  const units = useLoad(
    () => (caps?.services ? source.hostServices("system", "all").then((r) => r.units.map((u) => u.name)) : Promise.resolve([])),
    [source, caps?.services],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await source.hostLogs({ unit: unit || undefined, priority: priority === "all" ? undefined : priority, lines: 300 });
      cursor.current = page.cursor;
      setEntries(page.entries);
      setSelected(new Set());
      setError("");
    } catch (err) {
      setError(operatorError(err instanceof Error ? err.message : t("host.loadFailed"), t));
    } finally {
      setLoading(false);
    }
  }, [source, unit, priority, t]);

  useEffect(() => {
    if (caps?.logs) void load();
  }, [load, caps?.logs]);

  useEffect(() => {
    if (!follow || !caps?.logs) return;
    const id = setInterval(async () => {
      try {
        const page = await source.hostLogs({
          unit: unit || undefined,
          priority: priority === "all" ? undefined : priority,
          cursor: cursor.current,
          lines: 500,
        });
        cursor.current = page.cursor ?? cursor.current;
        if (page.entries.length) setEntries((cur) => [...(cur ?? []), ...page.entries].slice(-MAX_LOG_ROWS));
      } catch {
        /* the next tick retries */
      }
    }, FOLLOW_MS);
    return () => clearInterval(id);
  }, [follow, source, unit, priority, caps?.logs]);

  // Stay on the newest line, like tail -f, unless the operator scrolled up.
  useEffect(() => {
    const el = listRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight;
  }, [entries]);

  if (caps && !caps.logs) {
    return (
      <div className="host-page">
        <HostHead title={t("nav.logs")} />
        <Callout>{t("host.logsUnavailable")}</Callout>
      </div>
    );
  }

  function explain() {
    if (!entries) return;
    const lines = entries
      .filter((_, i) => selected.has(i))
      .map((e) => `${new Date(e.ts).toISOString()} ${e.unit ?? ""} ${e.message}`.trim())
      .join("\n");
    onDraft(`${fill(t("prompt.draft.explainLogs"), { source: unit || t("logs.allUnits") })}\n\n\`\`\`\n${lines}\n\`\`\``);
  }

  return (
    <div className="host-page host-page-fill">
      <HostHead
        title={t("nav.logs")}
        sub={entries ? <><span className="nums">{entries.length}</span> {t("logs.lines")}</> : undefined}
      >
        <RefreshButton busy={loading} onClick={() => void load()} />
      </HostHead>

      <div className="host-toolbar">
        <select className="host-select" value={unit} onChange={(e) => onUnit(e.target.value)} aria-label={t("logs.unit")}>
          <option value="">{t("logs.allUnits")}</option>
          {unit && !units.data?.includes(unit) ? <option value={unit}>{unit}</option> : null}
          {units.data?.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        <SegmentedControl
          label={t("logs.priority")}
          value={priority}
          onChange={setPriority}
          options={[
            { value: "all", label: t("logs.everything") },
            { value: "warning", label: t("logs.warnings") },
            { value: "err", label: t("logs.errors") },
          ]}
        />
        {/* Follow filters nothing, so it ends the row instead of heading the page. */}
        <span className="host-toolbar-end">
          <Switch checked={follow} onChange={setFollow} label={t("logs.follow")} />
        </span>
      </div>

      {error ? <Callout tone="danger">{error}</Callout> : null}
      {!entries && loading ? <Skeleton rows={8} label={t("host.loading")} /> : null}
      {entries ? (
        <div className="log-list" ref={listRef} role="list">
          {entries.length === 0 ? <p className="muted host-empty">{t("logs.empty")}</p> : null}
          {entries.map((e, i) => (
            <button
              key={i}
              type="button"
              role="listitem"
              aria-pressed={selected.has(i)}
              className={`log-line ${priorityClass(e.priority)}${selected.has(i) ? " selected" : ""}`}
              onClick={() =>
                setSelected((cur) => {
                  const next = new Set(cur);
                  if (next.has(i)) next.delete(i);
                  else next.add(i);
                  return next;
                })
              }
            >
              <span className="log-time nums">{formatLogTime(e.ts, Date.now(), locale)}</span>
              <span className="log-unit truncate">{e.unit ?? ""}</span>
              <span className="log-msg">{e.message}</span>
            </button>
          ))}
        </div>
      ) : null}

      {selected.size > 0 ? (
        <div className="selection-bar" role="status">
          <span className="nums">
            {selected.size} {t("logs.selected")}
          </span>
          <button type="button" className="ghost tiny" onClick={() => setSelected(new Set())}>
            {t("logs.clear")}
          </button>
          <button type="button" className="primary tiny" onClick={explain}>
            <IconZap />
            {t("logs.explain")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- files

function fileGlyph(e: FileEntry): ReactNode {
  if (e.type === "dir") return <IconFolder />;
  if (/\.(conf|ya?ml|json|toml|ini|service|timer|sh|py|js|ts|rb|go|rs)$/i.test(e.name)) return <IconFileCode />;
  return <IconFile />;
}

function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

function Crumbs({ path, onOpen }: { path: string; onOpen: (p: string) => void }) {
  const parts = path.split("/").filter(Boolean);
  return (
    <nav className="crumbs mono" aria-label={path}>
      <button type="button" onClick={() => onOpen("/")}>
        /
      </button>
      {parts.map((part, i) => {
        const to = `/${parts.slice(0, i + 1).join("/")}`;
        return (
          <span key={to} className="crumb">
            {i > 0 ? <span className="crumb-sep">/</span> : null}
            <button type="button" onClick={() => onOpen(to)} aria-current={i === parts.length - 1 ? "page" : undefined}>
              {part}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

export function FilesView({
  source,
  start,
  locale,
  onDraft,
  onMention,
  narrow,
}: {
  source: HostSource;
  start: string;
  locale: string;
  onDraft: Draft;
  onMention: (text: string) => void;
  narrow: boolean;
}) {
  const t = useT();
  const [dir, setDir] = useState(start || "/");
  const [file, setFile] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const listing = useLoad<DirListing>(() => source.hostFiles(dir), [source, dir]);
  const preview = useLoad<FilePreview | null>(
    () => (file ? source.hostFile(file) : Promise.resolve(null)),
    [source, file],
  );
  const lines = useMemo(() => (preview.data?.text ?? "").replace(/\n$/, "").split("\n"), [preview.data?.text]);

  function open(path: string) {
    setDir(path);
    setFile(null);
  }

  const list = (
    <div className="files-pane">
      <div className="files-pane-head">
        <button
          type="button"
          className="icon-btn sm"
          disabled={!listing.data?.parent}
          onClick={() => listing.data?.parent && open(listing.data.parent)}
          aria-label={t("files.up")}
          title={t("files.up")}
        >
          <IconArrowUp />
        </button>
        <Crumbs path={listing.data?.path ?? dir} onOpen={open} />
      </div>
      <div className="files-scroll">
        {listing.error ? <Callout tone="danger">{listing.error}</Callout> : null}
        {!listing.data && listing.loading ? <Skeleton rows={8} label={t("host.loading")} /> : null}
        {listing.data && listing.data.entries.length === 0 ? <p className="muted host-empty">{t("files.empty")}</p> : null}
        {listing.data?.entries.map((e) => {
          const path = joinPath(listing.data!.path, e.name);
          return (
            <ListRow
              key={e.name}
              glyph={fileGlyph(e)}
              current={file === path}
              onClick={() => (e.type === "dir" ? open(path) : setFile(path))}
              title={path}
              tail={
                <>
                  <span className="files-size">{e.type !== "dir" ? formatBytes(e.size, locale) : ""}</span>
                  <span className="files-mtime">{e.mtime ? formatRelativeShort(new Date(e.mtime).toISOString(), Date.now(), locale) : ""}</span>
                </>
              }
            >
              {e.name}
              {e.type === "link" ? <span className="muted"> →</span> : null}
            </ListRow>
          );
        })}
        {listing.data?.truncated ? <p className="muted host-empty">{t("files.truncatedDir")}</p> : null}
      </div>
    </div>
  );

  const view = (
    <div className="files-pane preview-pane">
      {file ? (
        <>
          <div className="files-pane-head">
            {narrow ? (
              <button type="button" className="icon-btn sm" onClick={() => setFile(null)} aria-label={t("files.back")} title={t("files.back")}>
                <IconChevronLeft />
              </button>
            ) : null}
            <span className="mono truncate preview-path" title={file}>
              {file}
            </span>
            <button
              type="button"
              className="icon-btn sm"
              aria-label={t("files.copyPath")}
              title={copied ? t("chat.copied") : t("files.copyPath")}
              onClick={() =>
                void navigator.clipboard.writeText(file).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
              }
            >
              {copied ? <IconCheck /> : <IconCopy />}
            </button>
            <button type="button" className="ghost tiny" title={t("files.mention")} onClick={() => onMention(`\`${file}\``)}>
              <IconMention />
              <span className="btn-label">{t("files.mention")}</span>
            </button>
            <button
              type="button"
              className="ghost tiny"
              title={t("files.askChange")}
              onClick={() => onDraft(fill(t("prompt.draft.fileChange"), { path: file }))}
            >
              <IconZap />
              <span className="btn-label">{t("files.askChange")}</span>
            </button>
          </div>
          <div className="files-scroll">
            {preview.error ? <Callout tone="danger">{preview.error}</Callout> : null}
            {preview.loading && !preview.data ? <Skeleton rows={8} label={t("host.loading")} /> : null}
            {preview.data?.binary ? <Callout>{t("files.binary")}</Callout> : null}
            {preview.data?.text !== undefined ? (
              <pre className="file-preview">
                {lines.map((line, i) => (
                  <span key={i} className="file-line">
                    <span className="file-no" aria-hidden="true">
                      {i + 1}
                    </span>
                    <code>{line}</code>
                  </span>
                ))}
              </pre>
            ) : null}
            {preview.data?.truncated ? <p className="muted host-empty">{t("files.truncated")}</p> : null}
          </div>
        </>
      ) : (
        <div className="preview-empty muted">
          <IconFile />
          <p>{t("files.pick")}</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="host-page host-page-fill files-page">
      <HostHead title={t("nav.files")} sub={t("files.readOnly")} />
      <div className={`files-split${narrow ? " narrow" : ""}`}>
        {narrow ? (file ? view : list) : (
          <>
            {list}
            {view}
          </>
        )}
      </div>
    </div>
  );
}

/** The views with their shared navigation, as the app mounts them. */
export function HostViews({
  view,
  onView,
  caps,
  source = api,
  locale,
  cwd,
  narrow,
  onDraft,
  onMention,
}: {
  view: HostViewId;
  onView: (v: HostViewId) => void;
  caps: HostCapabilities | null;
  source?: HostSource;
  locale: string;
  cwd: string;
  narrow: boolean;
  onDraft: Draft;
  onMention: (text: string) => void;
}) {
  const t = useT();
  const [logUnit, setLogUnit] = useState("");
  return (
    <main className="host-main">
      <h1 className="visually-hidden">{t(`nav.${view}`)}</h1>
      {/* On a phone the three machine views share one tab, and this switches
          between them; on a desktop the topbar's tabs do. */}
      {narrow && view !== "files" ? (
        <div className="host-subnav">
          <SegmentedControl
            label={t("nav.host")}
            value={view}
            onChange={onView}
            options={[
              { value: "overview", label: t("nav.overview"), glyph: <IconGauge /> },
              { value: "services", label: t("nav.services"), glyph: <IconServices /> },
              { value: "logs", label: t("nav.logs"), glyph: <IconLogs /> },
            ]}
          />
        </div>
      ) : null}
      {view === "overview" && <OverviewView source={source} caps={caps} locale={locale} onDraft={onDraft} onView={onView} />}
      {view === "services" && (
        <ServicesView
          source={source}
          caps={caps}
          onDraft={onDraft}
          onLogs={(unit) => {
            setLogUnit(unit);
            onView("logs");
          }}
        />
      )}
      {view === "logs" && (
        <LogsView source={source} caps={caps} locale={locale} unit={logUnit} onUnit={setLogUnit} onDraft={onDraft} />
      )}
      {view === "files" && (
        <FilesView source={source} start={cwd} locale={locale} onDraft={onDraft} onMention={onMention} narrow={narrow} />
      )}
    </main>
  );
}
