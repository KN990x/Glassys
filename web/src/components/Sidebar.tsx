import type { Ref } from "react";
import type { Theme } from "@glassys/protocol";
import { useT } from "../i18n";
import {
  GlassysMark,
  IconMonitor,
  IconMoon,
  IconPlus,
  IconRailClose,
  IconRailOpen,
  IconSearch,
  IconSettings,
  IconSun,
  IconThreads,
} from "./Icon";
import { Kbd } from "./Primitives";
import { ThreadList, type ThreadListProps } from "./ThreadList";
import { HostContext, type HostInfo } from "./HostContext";

const THEME_ORDER: Theme[] = ["dark", "light", "system"];

export function nextTheme(current: Theme): Theme {
  const i = THEME_ORDER.indexOf(current);
  return THEME_ORDER[(i + 1) % THEME_ORDER.length] ?? "dark";
}

/**
 * Persistent desktop rail: which space this is, its workspaces and threads, and
 * which machine the agent runs on. Its head shares the 56px header band with
 * the topbar and the inspector; its foot is one row. It collapses to a 56px
 * strip so a narrow laptop can give the transcript the width instead.
 */
export function Sidebar({
  spaceName,
  statusClass,
  statusLabel,
  host,
  threads,
  onNew,
  onSearch,
  onSettings,
  settingsRef,
  onCopyFailed,
  collapsed,
  onCollapse,
  theme,
  onTheme,
}: {
  spaceName: string;
  statusClass: string;
  statusLabel: string;
  host: HostInfo;
  threads: ThreadListProps;
  onNew: () => void;
  onSearch: () => void;
  onSettings: () => void;
  onCopyFailed: () => void;
  settingsRef?: Ref<HTMLButtonElement>;
  collapsed: boolean;
  onCollapse: (next: boolean) => void;
  theme: Theme;
  onTheme: (next: Theme) => void;
}) {
  const t = useT();
  const connected = statusClass === "connected";
  const themeGlyph = theme === "light" ? <IconSun /> : theme === "system" ? <IconMonitor /> : <IconMoon />;
  const themeLabel = `${t("settings.theme")}: ${t(`settings.theme.${theme}`)}`;
  const newDisabled = threads.busy || threads.waiting;

  if (collapsed) {
    return (
      <aside className="sidebar mini" aria-label={t("nav.threads")}>
        <div className="sidebar-head">
          <button
            type="button"
            className="icon-btn"
            onClick={() => onCollapse(false)}
            aria-label={t("nav.expandRail")}
            title={t("nav.expandRail")}
          >
            <IconRailOpen />
          </button>
        </div>
        <div className="mini-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={onNew}
            disabled={newDisabled}
            aria-label={t("threads.new")}
            title={t("threads.new")}
          >
            <IconPlus />
          </button>
          <button type="button" className="icon-btn" onClick={onSearch} aria-label={t("nav.search")} title={t("nav.search")}>
            <IconSearch />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => onCollapse(false)}
            aria-label={t("threads.title")}
            title={t("threads.title")}
          >
            <IconThreads />
          </button>
        </div>
        <div className="sidebar-foot mini-foot">
          <span className={`status dot-only ${statusClass}${connected ? " quiet" : ""}`} aria-live="polite" title={statusLabel}>
            <span className="visually-hidden">{statusLabel}</span>
          </span>
          <button
            ref={settingsRef}
            type="button"
            className="icon-btn"
            onClick={onSettings}
            aria-label={t("nav.settings")}
            title={t("nav.settings")}
          >
            <IconSettings />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="sidebar" aria-label={t("nav.threads")}>
      <div className="sidebar-head">
        <div className="brand tight">
          <GlassysMark size={20} />
          <strong className="truncate">{spaceName}</strong>
          {/* Connected is the normal state; only an exception earns a word. */}
          <span className={`status ${statusClass}${connected ? " dot-only quiet" : ""}`} aria-live="polite" title={statusLabel}>
            {connected ? <span className="visually-hidden">{statusLabel}</span> : statusLabel}
          </span>
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={() => onCollapse(true)}
          aria-label={t("nav.collapseRail")}
          title={t("nav.collapseRail")}
        >
          <IconRailClose />
        </button>
      </div>

      <div className="sidebar-actions">
        <button type="button" className="rail-new" onClick={onNew} disabled={newDisabled}>
          <IconPlus />
          <span className="truncate">{t("threads.new")}</span>
          <Kbd>⌘⇧O</Kbd>
        </button>
        <button type="button" className="icon-btn" onClick={onSearch} aria-label={t("nav.search")} title={t("nav.search")}>
          <IconSearch />
        </button>
      </div>

      <div className="sidebar-scroll">
        <ThreadList {...threads} showFilter={false} />
      </div>

      <div className="sidebar-foot">
        <HostContext info={host} variant="rail" onCopyFailed={onCopyFailed} />
        <button
          type="button"
          className="icon-btn"
          onClick={() => onTheme(nextTheme(theme))}
          aria-label={themeLabel}
          title={themeLabel}
        >
          {themeGlyph}
        </button>
        <button
          ref={settingsRef}
          type="button"
          className="icon-btn"
          onClick={onSettings}
          aria-label={t("nav.settings")}
          title={t("nav.settings")}
        >
          <IconSettings />
        </button>
      </div>
    </aside>
  );
}
