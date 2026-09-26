import { useState, type RefObject } from "react";
import type { HostCapabilities } from "@glassys/protocol";
import { useT } from "../i18n";
import { HostContext, type HostInfo } from "./HostContext";
import { PopAnchor, Popover } from "./Popover";
import { ViewTabs, type AppView } from "./ViewTabs";
import { IconActivity, IconClose, IconExport, IconMore, IconRename, IconSearch, IconTrash } from "./Icon";

export type TopbarSearch = {
  open: boolean;
  value: string;
  onChange: (next: string) => void;
  onOpen: () => void;
  onClose: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
  /** "3/41" while a query is typed. */
  count?: string;
};

/**
 * The centre column's head: which thread (or which host view) this is, where
 * it runs, the view tabs, and the thread's own actions. Renaming and the …
 * menu are its own state; search stays with the chat because it filters the
 * transcript and ⌘F opens it from anywhere.
 */
export function Topbar({
  view,
  onView,
  caps,
  isDesktop,
  statusClass,
  statusLabel,
  hostLabel,
  hostInfo,
  onCopyFailed,
  threadId,
  threadTitle,
  onRename,
  onExport,
  onDelete,
  search,
  activityOpen,
  onActivity,
}: {
  view: AppView;
  onView: (next: AppView) => void;
  caps: HostCapabilities | null;
  isDesktop: boolean;
  statusClass: string;
  statusLabel: string;
  hostLabel: string;
  hostInfo: HostInfo;
  onCopyFailed: () => void;
  threadId: string | null;
  /** The title as shown, and the stored one the rename field starts from. */
  threadTitle: { shown: string; stored: string };
  onRename: (id: string, title: string) => void;
  onExport: () => void;
  onDelete: (id: string) => void;
  search: TopbarSearch;
  activityOpen: boolean;
  onActivity: (next: boolean) => void;
}) {
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");

  function startRename() {
    setDraft(threadTitle.stored);
    setRenaming(true);
  }

  // On a phone the rail is gone, so the connection dot rides on the title —
  // and, as in the rail, only when something is wrong: connected is normal.
  const dot = !isDesktop && statusClass !== "connected" ? (
    <span className={`status dot-only ${statusClass}`} aria-live="polite" title={statusLabel}>
      <span className="visually-hidden">{statusLabel}</span>
    </span>
  ) : null;

  if (search.open) {
    return (
      <header className="topbar">
        <div className="topbar-inner">
          <span className="search-field topbar-search">
            <IconSearch />
            <input
              type="search"
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={t("chat.search")}
              aria-label={t("chat.search")}
              ref={search.inputRef}
              autoFocus
            />
            {search.value.trim() && search.count ? <span className="search-count nums muted">{search.count}</span> : null}
            <button
              type="button"
              className="icon-btn sm"
              aria-label={t("chat.searchClose")}
              title={t("chat.searchClose")}
              onClick={search.onClose}
            >
              <IconClose />
            </button>
          </span>
        </div>
      </header>
    );
  }

  return (
    <header className="topbar">
      <div className="topbar-inner">
        {/* One line on the desktop, so the title shares its baseline with the
            rail's and the inspector's heads; a phone has room for two. A host
            view names the machine: the tab already says which view it is. */}
        <div className={`topbar-title${isDesktop ? " one-line" : ""}`}>
          {view !== "chat" ? (
            <span className="topbar-heading">
              {dot}
              <strong className="truncate">{hostLabel || t("host.machine")}</strong>
            </span>
          ) : renaming ? (
            <form
              className="thread-rename"
              onSubmit={(e) => {
                e.preventDefault();
                if (threadId) onRename(threadId, draft);
                setRenaming(false);
              }}
            >
              <input
                value={draft}
                aria-label={t("threads.rename")}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => setRenaming(false)}
                autoFocus
              />
              <button type="submit" className="ghost tiny">
                {t("threads.saveTitle")}
              </button>
            </form>
          ) : (
            <>
              <button
                type="button"
                className="topbar-heading"
                disabled={!threadId}
                title={threadId ? t("threads.rename") : threadTitle.shown}
                onClick={startRename}
              >
                {dot}
                <strong className="truncate">{threadTitle.shown}</strong>
              </button>
              <HostContext info={hostInfo} variant="path" onCopyFailed={onCopyFailed} />
            </>
          )}
        </div>
        {isDesktop && <ViewTabs value={view} onChange={onView} caps={caps} />}
        {view === "chat" ? (
          <div className="top-actions">
            <button type="button" className="icon-btn" onClick={search.onOpen} aria-label={t("chat.search")} title={t("chat.search")}>
              <IconSearch />
            </button>
            <button
              type="button"
              className={`icon-btn${activityOpen ? " current" : ""}`}
              aria-pressed={activityOpen}
              onClick={() => onActivity(!activityOpen)}
              aria-label={t("nav.activity")}
              title={t("nav.activity")}
            >
              <IconActivity />
            </button>
            <PopAnchor>
              <button
                type="button"
                className="icon-btn"
                aria-expanded={menuOpen}
                aria-label={t("chat.more")}
                title={t("chat.more")}
                onClick={() => setMenuOpen((v) => !v)}
              >
                <IconMore />
              </button>
              <Popover open={menuOpen} onClose={() => setMenuOpen(false)} label={t("chat.more")} side="bottom" align="end" className="pop-menu">
                <button
                  type="button"
                  className="ghost picker-item"
                  disabled={!threadId}
                  onClick={() => {
                    setMenuOpen(false);
                    startRename();
                  }}
                >
                  <IconRename />
                  <strong>{t("threads.rename")}</strong>
                </button>
                <button
                  type="button"
                  className="ghost picker-item"
                  disabled={!threadId}
                  onClick={() => {
                    setMenuOpen(false);
                    onExport();
                  }}
                >
                  <IconExport />
                  <strong>{t("chat.export")}</strong>
                </button>
                <div className="pop-divider" role="separator" />
                <button
                  type="button"
                  className="ghost picker-item danger-item"
                  disabled={!threadId}
                  onClick={() => {
                    setMenuOpen(false);
                    if (threadId) onDelete(threadId);
                  }}
                >
                  <IconTrash />
                  <strong>{t("threads.delete")}</strong>
                </button>
              </Popover>
            </PopAnchor>
          </div>
        ) : null}
      </div>
    </header>
  );
}
