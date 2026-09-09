import { useEffect, useRef } from "react";
import { useT } from "../i18n";
import { IconClose, IconExport, IconPlus } from "./Icon";
import { ThreadList, type ThreadListProps } from "./ThreadList";

/**
 * Mobile sheet around the shared thread list. The desktop rail renders the same
 * list without this chrome.
 */
export function ThreadDrawer({
  onNew,
  onClose,
  onExport,
  currentId,
  ...list
}: ThreadListProps & {
  onNew: () => void;
  onClose: () => void;
  onExport?: () => void;
}) {
  const t = useT();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const root = document.querySelector(".thread-panel");
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !root) return;
      const nodes = [
        ...root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      ].filter((el) => !el.hasAttribute("disabled"));
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="thread-drawer" role="dialog" aria-modal="true" aria-labelledby="threads-title">
      {/* A full-viewport <button> used to sit in the tab order and paint a
          viewport-wide focus ring; the real close control is in the header. */}
      <div className="thread-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="thread-panel">
        <header>
          <h2 id="threads-title">{t("threads.title")}</h2>
          <div className="row">
            {onExport && currentId && (
              <button
                type="button"
                className="icon-btn"
                onClick={onExport}
                aria-label={t("chat.export")}
                title={t("chat.export")}
              >
                <IconExport />
              </button>
            )}
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
          </div>
        </header>
        <button
          type="button"
          className="primary sidebar-new"
          onClick={onNew}
          disabled={list.busy || list.waiting}
        >
          <IconPlus />
          {t("threads.new")}
        </button>
        <p className="muted thread-hint">{t("threads.switchResume")}</p>
        <ThreadList {...list} currentId={currentId} />
      </aside>
    </div>
  );
}
