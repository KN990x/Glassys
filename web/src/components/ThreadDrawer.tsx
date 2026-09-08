import { useEffect, useRef, useState } from "react";
import type { ThreadSummary } from "@glassys/protocol";
import { useT } from "../i18n";
import { cwdBasename, formatRelativeTime, groupThreadsByCwd } from "../format";

export function ThreadDrawer({
  threads,
  currentId,
  locale,
  busy,
  waiting,
  onNew,
  onSwitch,
  onDelete,
  onRename,
  onClose,
  git,
  currentCwd,
  pins,
  recents,
  onOpenCwd,
  onPin,
  onUnpin,
}: {
  threads: ThreadSummary[];
  currentId: string | null;
  locale: string;
  busy: boolean;
  waiting: boolean;
  onNew: () => void;
  onSwitch: (id: string) => void;
  onDelete: (id: string, e: { stopPropagation: () => void }) => void;
  onRename: (id: string, title: string) => Promise<void>;
  onClose: () => void;
  git?: { branch: string; dirty: boolean };
  currentCwd?: string;
  pins?: string[];
  recents?: string[];
  onOpenCwd?: (cwd: string) => void;
  onPin?: (cwd: string) => void;
  onUnpin?: (cwd: string) => void;
}) {
  const t = useT();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const groups = groupThreadsByCwd(threads);

  useEffect(() => {
    closeRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const root = document.querySelector(".thread-panel");
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (editing) {
          setEditing(null);
          return;
        }
        onClose();
        return;
      }
      if (e.key !== "Tab" || !root) return;
      const nodes = [...root.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )].filter((el) => !el.hasAttribute("disabled"));
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
  }, [onClose, editing]);

  return (
    <div className="thread-drawer" role="dialog" aria-modal="true" aria-labelledby="threads-title">
      <button type="button" className="thread-scrim" aria-label={t("threads.close")} onClick={onClose} />
      <aside className="thread-panel">
        <header>
          <h2 id="threads-title">{t("threads.title")}</h2>
          <div className="row">
            <button type="button" className="primary" onClick={onNew} disabled={busy || waiting}>
              {t("threads.new")}
            </button>
            <button ref={closeRef} type="button" className="ghost" onClick={onClose}>
              {t("threads.close")}
            </button>
          </div>
        </header>
        <p className="muted">{t("threads.switchResume")}</p>
        {pins && pins.length > 0 && (
          <section className="thread-group">
            <h3 className="thread-context">{t("threads.pins")}</h3>
            <ul className="thread-list">
              {pins.map((cwd) => (
                <li key={`pin:${cwd}`} className="thread-row">
                  <button
                    type="button"
                    className={`ghost picker-item${cwd === currentCwd ? " current" : ""}`}
                    onClick={() => onOpenCwd?.(cwd)}
                    disabled={busy || waiting}
                  >
                    <strong>{cwdBasename(cwd)}</strong>
                    <span className="muted">{cwd}</span>
                  </button>
                  <button type="button" className="ghost tiny" onClick={() => onUnpin?.(cwd)}>
                    {t("threads.unpin")}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {recents && recents.filter((c) => !(pins || []).includes(c)).length > 0 && (
          <section className="thread-group">
            <h3 className="thread-context">{t("threads.recents")}</h3>
            <ul className="thread-list">
              {recents
                .filter((c) => !(pins || []).includes(c))
                .map((cwd) => (
                  <li key={`recent:${cwd}`} className="thread-row">
                    <button
                      type="button"
                      className={`ghost picker-item${cwd === currentCwd ? " current" : ""}`}
                      onClick={() => onOpenCwd?.(cwd)}
                      disabled={busy || waiting}
                    >
                      <strong>{cwdBasename(cwd)}</strong>
                      <span className="muted">{cwd}</span>
                    </button>
                    <button type="button" className="ghost tiny" onClick={() => onPin?.(cwd)}>
                      {t("threads.pin")}
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        )}
        {threads.length === 0 && <p className="muted">{t("threads.empty")}</p>}
        {groups.map((group) => (
          <section key={group.cwd || "none"} className="thread-group">
            <h3 className="thread-context">{group.cwd ? cwdBasename(group.cwd) : t("threads.context")}</h3>
            {group.cwd ? (
              <p className="muted thread-cwd">
                {group.cwd}
                {git && group.threads.some((th) => th.id === currentId)
                  ? ` · ${git.branch}${git.dirty ? ` (${t("chat.gitDirty")})` : ""}`
                  : ""}
              </p>
            ) : null}
            <ul className="thread-list">
              {group.threads.map((th) => (
                <li key={th.id} className="thread-row">
                  {editing === th.id ? (
                    <form
                      className="thread-rename"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void onRename(th.id, draftTitle).then(() => setEditing(null));
                      }}
                    >
                      <input
                        value={draftTitle}
                        aria-label={t("threads.rename")}
                        onChange={(e) => setDraftTitle(e.target.value)}
                        autoFocus
                      />
                      <button type="submit" className="ghost tiny">
                        {t("threads.saveTitle")}
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      className={`ghost picker-item${th.id === currentId ? " current" : ""}`}
                      onClick={() => void onSwitch(th.id)}
                    >
                      <strong>{th.title}</strong>
                      <span className="muted">
                        {th.id === currentId ? `${t("threads.current")} · ` : ""}
                        {th.adapter} · {formatRelativeTime(th.updatedAt, Date.now(), locale)}
                        {th.usage && (th.usage.inputTokens || th.usage.outputTokens)
                          ? ` · ↓${th.usage.inputTokens} ↑${th.usage.outputTokens}`
                          : ""}
                      </span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="ghost tiny"
                    aria-label={t("threads.rename")}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing(th.id);
                      setDraftTitle(th.title);
                    }}
                  >
                    {t("threads.rename")}
                  </button>
                  <button
                    type="button"
                    className="ghost tiny"
                    aria-label={t("threads.delete")}
                    onClick={(e) => void onDelete(th.id, e)}
                  >
                    {t("threads.delete")}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </aside>
    </div>
  );
}
