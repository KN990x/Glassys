import type { Ref } from "react";
import { useT } from "../i18n";
import { GlassysMark, IconExport, IconPlus, IconSettings } from "./Icon";
import { ThreadList, type ThreadListProps } from "./ThreadList";
import { HostContext, type HostInfo } from "./HostContext";

/**
 * Persistent desktop rail. Everything that used to be crammed into the growing
 * left half of the topbar — name, status, host facts — lives here at a stable
 * width, so the topbar can stay one fixed-height row.
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
  onExport,
  canExport,
  onCopyFailed,
}: {
  spaceName: string;
  statusClass: string;
  statusLabel: string;
  host: HostInfo;
  threads: ThreadListProps;
  onNew: () => void;
  onSettings: () => void;
  onExport: () => void;
  canExport: boolean;
  settingsRef?: Ref<HTMLButtonElement>;
  onCopyFailed: () => void;
}) {
  const t = useT();
  return (
    <aside className="sidebar" aria-label={t("nav.threads")}>
      <div className="sidebar-head">
        <div className="brand tight">
          <GlassysMark size={22} />
          <div className="sidebar-identity">
            <strong className="truncate">{spaceName}</strong>
            <span className={`status ${statusClass}`} aria-live="polite">
              {statusLabel}
            </span>
          </div>
        </div>
      </div>

      <div className="sidebar-actions">
        <button
          type="button"
          className="primary sidebar-new"
          onClick={onNew}
          disabled={threads.busy || threads.waiting}
        >
          <IconPlus size={16} />
          {t("threads.new")}
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={onExport}
          disabled={!canExport}
          aria-label={t("chat.export")}
          title={t("chat.export")}
        >
          <IconExport size={16} />
        </button>
      </div>

      <div className="sidebar-scroll">
        <ThreadList {...threads} />
      </div>

      <div className="sidebar-foot">
        <HostContext info={host} variant="rows" onCopyFailed={onCopyFailed} />
        <button ref={settingsRef} type="button" className="ghost sidebar-settings" onClick={onSettings}>
          <IconSettings size={16} />
          {t("nav.settings")}
        </button>
      </div>
    </aside>
  );
}
