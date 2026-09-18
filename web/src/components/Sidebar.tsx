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
 * Persistent desktop rail: who the host is, what threads it has, and the two
 * controls the operator reaches for without looking. It collapses to a 56px
 * strip so a narrow laptop can give the transcript the width instead.
 */
export function Sidebar({
  spaceName,
  statusClass,
  statusLabel,
  host,
  threads,
  onNew,
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
        <button
          type="button"
          className="icon-btn"
          onClick={onNew}
          disabled={threads.busy || threads.waiting}
          aria-label={t("threads.new")}
          title={t("threads.new")}
        >
          <IconPlus />
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
        <div className="sidebar-foot mini-foot">
          <span
            className={`status dot-only ${statusClass}`}
            aria-live="polite"
            title={statusLabel}
          >
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
          <GlassysMark size={22} />
          <div className="sidebar-identity">
            <strong className="truncate">{spaceName}</strong>
            {/* Connected is the normal state; only the exceptions need a word. */}
            <span className={`status ${statusClass}${connected ? " dot-only" : ""}`} aria-live="polite" title={statusLabel}>
              {connected ? <span className="visually-hidden">{statusLabel}</span> : statusLabel}
            </span>
          </div>
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
        <button
          type="button"
          className="ghost sidebar-new"
          onClick={onNew}
          disabled={threads.busy || threads.waiting}
        >
          <IconPlus />
          <span className="truncate">{t("threads.new")}</span>
          <Kbd>⌘⇧O</Kbd>
        </button>
      </div>

      <div className="sidebar-scroll">
        <ThreadList {...threads} />
      </div>

      <div className="sidebar-foot">
        <HostContext info={host} variant="card" onCopyFailed={onCopyFailed} />
        <div className="sidebar-foot-actions">
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
      </div>
    </aside>
  );
}
