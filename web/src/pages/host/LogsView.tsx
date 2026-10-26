import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { HostCapabilities, LogEntry, LogPriority, ServiceScope } from "@glassys/protocol";
import { useT } from "../../i18n";
import { formatLogTime } from "../../format";
import { operatorError } from "../../operatorError";
import { Callout, Skeleton } from "../../components/Primitives";
import { SegmentedControl } from "../../components/SegmentedControl";
import { Switch } from "../../components/Switch";
import { IconZap } from "../../components/Icon";
import { HostHead, RefreshButton, fill, useLoad, type Draft, type HostSource } from "./shared";

/** Logs: the journal, filtered and followed like tail -f; picked lines go to the agent to explain. */

const FOLLOW_MS = 5_000;
/** Lines kept while following; older ones scroll off the top. */
export const MAX_LOG_ROWS = 5_000;

function priorityClass(p: number): string {
  if (p <= 3) return "err";
  if (p === 4) return "warn";
  return "";
}

/** A log line with a key that survives Follow trimming the head of the list. */
type KeyedEntry = LogEntry & { key: number };

/** One row, memoized: Follow appends every few seconds and must not reformat 5,000 timestamps. */
const LogLine = memo(function LogLine({
  entry,
  selected,
  locale,
  onToggle,
  tabbable,
  onFocusLine,
}: {
  entry: KeyedEntry;
  selected: boolean;
  locale: string;
  onToggle: (key: number) => void;
  /** The list is one tab stop: only the line last focused takes Tab; arrows move between lines. */
  tabbable: boolean;
  onFocusLine: (key: number) => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      tabIndex={tabbable ? 0 : -1}
      onFocus={() => onFocusLine(entry.key)}
      className={`log-line ${priorityClass(entry.priority)}${selected ? " selected" : ""}`}
      onClick={() => onToggle(entry.key)}
    >
      <span className="log-time nums">{formatLogTime(entry.ts, Date.now(), locale)}</span>
      <span className="log-unit truncate">{entry.unit ?? ""}</span>
      <span className="log-msg">{entry.message}</span>
    </button>
  );
});

export function LogsView({
  source,
  caps,
  locale,
  unit,
  scope = "system",
  onUnit,
  onDraft,
}: {
  source: HostSource;
  caps: HostCapabilities | null;
  locale: string;
  unit: string;
  scope?: ServiceScope;
  onUnit: (unit: string) => void;
  onDraft: Draft;
}) {
  const t = useT();
  const [priority, setPriority] = useState<LogPriority | "all">("all");
  const [follow, setFollow] = useState(false);
  const [entries, setEntries] = useState<KeyedEntry[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  /* Selection by key, not position: once Follow trims the head, positions point at other lines
     and "Explain" sent lines the operator never picked. */
  const [selected, setSelected] = useState<Set<number>>(new Set());
  /** The line that holds the list's single tab stop; the newest until the operator moves. */
  const [focusKey, setFocusKey] = useState<number | null>(null);
  const nextKey = useRef(0);
  const keyed = (list: LogEntry[]): KeyedEntry[] => list.map((e) => ({ ...e, key: nextKey.current++ }));
  const toggleLine = useCallback((key: number) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const cursor = useRef<string | undefined>(undefined);
  const listRef = useRef<HTMLDivElement>(null);
  const units = useLoad(
    () => (caps?.services ? source.hostServices("system", "all").then((r) => r.units.map((u) => u.name)) : Promise.resolve([])),
    [source, caps?.services],
  );

  /* Bumped by every full load and filter change; a reply from an older
     generation belongs to another unit or priority and is dropped. */
  const generation = useRef(0);
  const fullLoads = useRef(0);

  /** Whether the list follows the newest line; the operator scrolling up turns it off. */
  const stickToBottom = useRef(true);

  const load = useCallback(async () => {
    const gen = ++generation.current;
    fullLoads.current += 1;
    stickToBottom.current = true;
    setLoading(true);
    try {
      const page = await source.hostLogs({
        unit: unit || undefined,
        priority: priority === "all" ? undefined : priority,
        lines: 300,
        ...(unit ? { scope } : {}),
      });
      if (gen !== generation.current) return;
      cursor.current = page.cursor;
      setEntries(keyed(page.entries));
      setSelected(new Set());
      setError("");
    } catch (err) {
      if (gen !== generation.current) return;
      setError(operatorError(err instanceof Error ? err.message : t("host.loadFailed"), t));
    } finally {
      fullLoads.current -= 1;
      if (gen === generation.current) setLoading(false);
    }
  }, [source, unit, scope, priority, t]);

  useEffect(() => {
    if (caps?.logs) void load();
    return () => {
      generation.current += 1;
    };
  }, [load, caps?.logs]);

  useEffect(() => {
    if (!follow || !caps?.logs) return;
    let inFlight = false;
    const id = setInterval(async () => {
      if (inFlight || fullLoads.current > 0) return;
      inFlight = true;
      const gen = generation.current;
      try {
        const page = await source.hostLogs({
          unit: unit || undefined,
          priority: priority === "all" ? undefined : priority,
          cursor: cursor.current,
          lines: 500,
          ...(unit ? { scope } : {}),
        });
        if (gen !== generation.current) return;
        cursor.current = page.cursor ?? cursor.current;
        if (page.entries.length) setEntries((cur) => [...(cur ?? []), ...keyed(page.entries)].slice(-MAX_LOG_ROWS));
      } catch {
        /* the next tick retries */
      } finally {
        inFlight = false;
      }
    }, FOLLOW_MS);
    return () => clearInterval(id);
  }, [follow, source, unit, scope, priority, caps?.logs]);

  /*
   * Stay on the newest line, like tail -f, unless the operator scrolled up. Decided from where the
   * list was before the new rows came in: measured after them, a first load (scrolled to the top)
   * never moved, and a burst taller than the margin stopped following.
   */
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [entries]);

  /* Follow trims old rows; a selection must not count lines that are gone. */
  useEffect(() => {
    if (!entries) return;
    setSelected((sel) => {
      if (!sel.size) return sel;
      const keys = new Set(entries.map((e) => e.key));
      const kept = [...sel].filter((k) => keys.has(k));
      return kept.length === sel.size ? sel : new Set(kept);
    });
  }, [entries]);

  /* Follow may have trimmed the focused line away: the newest takes the tab stop then. */
  const tabKey = entries?.some((e) => e.key === focusKey) ? focusKey : entries?.at(-1)?.key;

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
      .filter((e) => selected.has(e.key))
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
        <div
          className="log-list"
          ref={listRef}
          role="listbox"
          aria-multiselectable="true"
          aria-label={t("nav.logs")}
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
          onKeyDown={(e) => {
            const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
            const edge = e.key === "Home" ? "first" : e.key === "End" ? "last" : null;
            if (!step && !edge) return;
            const lines = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]')];
            const at = lines.indexOf(document.activeElement as HTMLButtonElement);
            const next = edge === "first" ? 0 : edge === "last" ? lines.length - 1 : at + step;
            if (next < 0 || next >= lines.length) return;
            e.preventDefault();
            lines[next]?.focus();
          }}
        >
          {entries.length === 0 ? <p className="muted host-empty">{t("logs.empty")}</p> : null}
          {entries.map((e) => (
            <LogLine
              key={e.key}
              entry={e}
              selected={selected.has(e.key)}
              locale={locale}
              onToggle={toggleLine}
              tabbable={e.key === tabKey}
              onFocusLine={setFocusKey}
            />
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
