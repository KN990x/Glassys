import { useState } from "react";
import type { ThreadSummary } from "@glassys/protocol";
import { useT } from "../i18n";
import { cwdBasename, formatRelativeTime, formatTokens, groupThreadsByCwd, truncateMiddle } from "../format";
import { IconPin, IconPinOff, IconRename, IconTrash } from "./Icon";

export type ThreadListProps = {
  threads: ThreadSummary[];
  currentId: string | null;
  locale: string;
  busy: boolean;
  waiting: boolean;
  onSwitch: (id: string) => void;
  onDelete: (id: string, e: { stopPropagation: () => void }) => void;
  onRename: (id: string, title: string) => Promise<void>;
  git?: { branch: string; dirty: boolean };
  currentCwd?: string;
  pins?: string[];
  recents?: string[];
  onOpenCwd?: (cwd: string) => void;
  onPin?: (cwd: string) => void;
  onUnpin?: (cwd: string) => void;
};

/** The thread list is the same in the desktop rail and the mobile sheet. */
export function ThreadList({
  threads,
  currentId,
  locale,
  busy,
  waiting,
  onSwitch,
  onDelete,
  onRename,
  git,
  currentCwd,
  pins,
  recents,
  onOpenCwd,
  onPin,
  onUnpin,
}: ThreadListProps) {
  const t = useT();
  const [editing, setEditing] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [filter, setFilter] = useState("");
  const q = filter.trim().toLowerCase();
  const visible = q
    ? threads.filter((th) => th.title.toLowerCase().includes(q) || th.cwd.toLowerCase().includes(q))
    : threads;
  const groups = groupThreadsByCwd(visible);
  const otherRecents = (recents || []).filter((c) => !(pins || []).includes(c));

  return (
    <div className="thread-list-body">
      <label className="thread-filter">
        <span className="visually-hidden">{t("threads.filter")}</span>
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("threads.filter")}
          aria-label={t("threads.filter")}
        />
      </label>

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
                  title={cwd}
                >
                  <strong>{cwdBasename(cwd)}</strong>
                  <span className="muted">{truncateMiddle(cwd)}</span>
                </button>
                <span className="row-actions">
                  <button
                    type="button"
                    className="icon-btn sm"
                    aria-label={t("threads.unpin")}
                    title={t("threads.unpin")}
                    onClick={() => onUnpin?.(cwd)}
                  >
                    <IconPinOff size={15} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {otherRecents.length > 0 && (
        <section className="thread-group">
          <h3 className="thread-context">{t("threads.recents")}</h3>
          <ul className="thread-list">
            {otherRecents.map((cwd) => (
              <li key={`recent:${cwd}`} className="thread-row">
                <button
                  type="button"
                  className={`ghost picker-item${cwd === currentCwd ? " current" : ""}`}
                  onClick={() => onOpenCwd?.(cwd)}
                  disabled={busy || waiting}
                  title={cwd}
                >
                  <strong>{cwdBasename(cwd)}</strong>
                  <span className="muted">{truncateMiddle(cwd)}</span>
                </button>
                <span className="row-actions">
                  <button
                    type="button"
                    className="icon-btn sm"
                    aria-label={t("threads.pin")}
                    title={t("threads.pin")}
                    onClick={() => onPin?.(cwd)}
                  >
                    <IconPin size={15} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {threads.length === 0 && <p className="muted thread-hint">{t("threads.empty")}</p>}

      {groups.map((group) => (
        <section key={group.cwd || "none"} className="thread-group">
          <h3 className="thread-context">{group.cwd ? cwdBasename(group.cwd) : t("threads.context")}</h3>
          {group.cwd ? (
            <p className="muted thread-cwd" title={group.cwd}>
              {truncateMiddle(group.cwd, 40)}
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
                  <>
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
                          ? ` · ↓${formatTokens(th.usage.inputTokens, locale)} ↑${formatTokens(th.usage.outputTokens, locale)}`
                          : ""}
                      </span>
                    </button>
                    <span className="row-actions">
                      <button
                        type="button"
                        className="icon-btn sm"
                        aria-label={t("threads.rename")}
                        title={t("threads.rename")}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditing(th.id);
                          setDraftTitle(th.title);
                        }}
                      >
                        <IconRename size={15} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn sm danger-hover"
                        aria-label={t("threads.delete")}
                        title={t("threads.delete")}
                        onClick={(e) => void onDelete(th.id, e)}
                      >
                        <IconTrash size={15} />
                      </button>
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
