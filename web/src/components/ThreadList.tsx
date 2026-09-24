import { useMemo, useState } from "react";
import type { ThreadSummary } from "@glassys/protocol";
import { useT } from "../i18n";
import { cwdBasename, formatRelativeShort, groupThreadsByCwd, truncateMiddle } from "../format";
import { IconChevronRight, IconPin, IconPinOff, IconRename, IconSearch, IconTrash } from "./Icon";
import { ListRow, StatusBadge } from "./Primitives";

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
  currentAdapter?: string;
  pins?: string[];
  recents?: string[];
  onOpenCwd?: (cwd: string) => void;
  onPin?: (cwd: string) => void;
  onUnpin?: (cwd: string) => void;
  /** The rail finds threads through the palette; the phone sheet keeps a field. */
  showFilter?: boolean;
};

type Workspace = {
  cwd: string;
  threads: ThreadSummary[];
  pinned: boolean;
};

/**
 * One workspace per row, its threads nested under it. The rail used to list the
 * same directory three times — once under Pinned, once as a group heading, once
 * as the group's path — before any thread title appeared.
 */
export function buildWorkspaces(input: {
  threads: ThreadSummary[];
  pins?: string[];
  recents?: string[];
  currentCwd?: string;
}): Workspace[] {
  const pins = input.pins ?? [];
  const byCwd = new Map<string, Workspace>();
  const order: string[] = [];
  const add = (cwd: string, threads: ThreadSummary[]) => {
    const existing = byCwd.get(cwd);
    if (existing) {
      existing.threads.push(...threads);
      return;
    }
    order.push(cwd);
    byCwd.set(cwd, { cwd, threads: [...threads], pinned: pins.includes(cwd) });
  };

  for (const group of groupThreadsByCwd(input.threads)) add(group.cwd, group.threads);
  for (const cwd of pins) add(cwd, []);
  for (const cwd of input.recents ?? []) add(cwd, []);

  const list = order.map((cwd) => byCwd.get(cwd)!);
  // Pinned first, then the workspace being worked in, then the rest as given.
  return list.sort((a, b) => {
    const rank = (w: Workspace) => (w.pinned ? 0 : w.cwd === input.currentCwd ? 1 : 2);
    return rank(a) - rank(b);
  });
}

/** The tree is the same in the desktop rail and the mobile sheet. */
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
  currentAdapter,
  pins,
  recents,
  onOpenCwd,
  onPin,
  onUnpin,
  showFilter = true,
}: ThreadListProps) {
  const t = useT();
  const [editing, setEditing] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const q = filter.trim().toLowerCase();
  const visible = q
    ? threads.filter((th) => th.title.toLowerCase().includes(q) || th.cwd.toLowerCase().includes(q))
    : threads;
  const workspaces = useMemo(
    () => buildWorkspaces({ threads: visible, pins, recents, currentCwd }),
    [visible, pins, recents, currentCwd],
  );

  return (
    <div className="thread-list-body">
      {showFilter && (
        <label className="thread-filter search-field">
          <span className="visually-hidden">{t("threads.filter")}</span>
          <IconSearch />
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("threads.filter")}
            aria-label={t("threads.filter")}
          />
        </label>
      )}

      {threads.length === 0 && !recents?.length && <p className="muted thread-hint">{t("threads.empty")}</p>}

      <nav className="ws-tree" aria-label={t("threads.title")}>
        {workspaces.map((ws) => {
          const open = !collapsed.includes(ws.cwd) && (q ? true : ws.threads.length > 0);
          const isCurrent = ws.cwd === currentCwd;
          const label = ws.cwd ? cwdBasename(ws.cwd) : t("threads.context");
          return (
            <section key={ws.cwd || "none"} className={`ws-group${isCurrent ? " current" : ""}`}>
              <div className="ws-row">
                {ws.threads.length > 0 ? (
                  <button
                    type="button"
                    className={`ws-twisty${open ? " open" : ""}`}
                    aria-expanded={open}
                    aria-label={label}
                    onClick={() =>
                      setCollapsed((cur) =>
                        cur.includes(ws.cwd) ? cur.filter((c) => c !== ws.cwd) : [...cur, ws.cwd],
                      )
                    }
                  >
                    <IconChevronRight />
                  </button>
                ) : (
                  <span className="ws-twisty empty" aria-hidden="true" />
                )}
                <button
                  type="button"
                  className="ws-open"
                  onClick={() => ws.cwd && onOpenCwd?.(ws.cwd)}
                  disabled={busy || waiting || !ws.cwd}
                  title={ws.cwd}
                  aria-current={isCurrent ? "true" : undefined}
                >
                  <span className="ws-line">
                    <span className="ws-name truncate">{label}</span>
                    {isCurrent && git ? (
                      <span
                        className={`ws-branch${git.dirty ? " dirty" : ""}`}
                        title={git.dirty ? `${git.branch} (${t("chat.gitDirty")})` : git.branch}
                      >
                        {git.branch}
                        {/* The amber dot says it to the eye; this says it aloud. */}
                        {git.dirty ? <span className="visually-hidden"> ({t("chat.gitDirty")})</span> : null}
                      </span>
                    ) : null}
                  </span>
                  <span className="ws-path truncate">{truncateMiddle(ws.cwd, 30)}</span>
                </button>
                <span className="ws-meta">
                  {ws.threads.length > 0 && <span className="ws-count nums">{ws.threads.length}</span>}
                </span>
                <span className="row-actions">
                  {ws.cwd ? (
                    <button
                      type="button"
                      className="icon-btn sm"
                      aria-label={ws.pinned ? t("threads.unpin") : t("threads.pin")}
                      title={ws.pinned ? t("threads.unpin") : t("threads.pin")}
                      onClick={() => (ws.pinned ? onUnpin?.(ws.cwd) : onPin?.(ws.cwd))}
                    >
                      {ws.pinned ? <IconPinOff /> : <IconPin />}
                    </button>
                  ) : null}
                </span>
              </div>

              {open && ws.threads.length > 0 && (
                <ul className="thread-list">
                  {ws.threads.map((th) => (
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
                        <ListRow
                          current={th.id === currentId}
                          onClick={() => void onSwitch(th.id)}
                          title={th.title}
                          tail={
                            <span className="thread-meta">
                              {th.adapter && th.adapter !== currentAdapter ? (
                                <StatusBadge>{th.adapter}</StatusBadge>
                              ) : null}
                              {th.id === currentId && busy ? (
                                <span className="pulse thread-live" aria-label={t("status.running")} />
                              ) : (
                                <span className="nums">{formatRelativeShort(th.updatedAt, Date.now(), locale)}</span>
                              )}
                            </span>
                          }
                          actions={
                            <>
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
                                <IconRename />
                              </button>
                              <button
                                type="button"
                                className="icon-btn sm danger-hover"
                                aria-label={t("threads.delete")}
                                title={t("threads.delete")}
                                onClick={(e) => void onDelete(th.id, e)}
                              >
                                <IconTrash />
                              </button>
                            </>
                          }
                        >
                          {th.title}
                        </ListRow>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </nav>
    </div>
  );
}
