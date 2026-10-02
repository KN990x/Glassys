import { useEffect, useRef } from "react";
import { useT } from "../i18n";
import { IconClose, IconPlus } from "./Icon";
import { ThreadList, type ThreadListProps } from "./ThreadList";
import { useDialogFocus } from "../useDialogFocus";

/**
 * Mobile sheet around the shared thread list. The desktop rail renders the same
 * list without this chrome.
 */
export function ThreadDrawer({
  onNew,
  onClose,
  currentId,
  ...list
}: ThreadListProps & {
  onNew: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  useDialogFocus(panelRef, onClose, closeRef);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div className="thread-drawer" role="dialog" aria-modal="true" aria-labelledby="threads-title">
      {/* A full-viewport <button> used to sit in the tab order and paint a
          viewport-wide focus ring; the real close control is in the header. */}
      <div className="thread-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="thread-panel" ref={panelRef}>
        <header>
          <h2 id="threads-title">{t("threads.title")}</h2>
          <button
            ref={closeRef}
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label={t("threads.close")}
            title={t("threads.close")}
          >
            <IconClose />
          </button>
        </header>
        <button type="button" className="rail-new" onClick={onNew} disabled={list.busy || list.waiting}>
          <IconPlus />
          {t("threads.new")}
        </button>
        <ThreadList {...list} currentId={currentId} />
      </aside>
    </div>
  );
}
