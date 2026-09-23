import { useMemo, useState } from "react";
import type { Block } from "../transcript";
import { deriveActivity } from "../activity";
import { useT } from "../i18n";
import { formatTokens, truncateMiddle } from "../format";
import { SegmentedControl } from "./SegmentedControl";
import { Disclosure, StatusBadge } from "./Primitives";
import { Hunk } from "./ToolCard";
import { IconAlert, IconCheck, IconClose, IconError, IconFileEdit, IconFile, IconSpinner, IconTerminal } from "./Icon";

export type ActivityTab = "commands" | "files";

/** Scroll the transcript to the call a row came from, and flash it. */
export function revealBlock(id: string): void {
  const node = document.getElementById(`tool-${id}`);
  if (!node) return;
  node.scrollIntoView({ block: "center", behavior: "smooth" });
  node.classList.add("flash");
  setTimeout(() => node.classList.remove("flash"), 1200);
}

/**
 * What the thread did to this host: the commands it ran and the files it
 * touched. A code UI has Git and Files panels for this; systems work needs the
 * same answer in its own terms, and the transcript already carries it.
 */
export function ActivityPanel({
  blocks,
  onClose,
  locale,
  duration,
}: {
  blocks: Block[];
  onClose?: () => void;
  locale: string;
  duration?: string;
}) {
  const t = useT();
  const [tab, setTab] = useState<ActivityTab>("commands");
  const [openFile, setOpenFile] = useState<string | null>(null);
  const activity = useMemo(() => deriveActivity(blocks), [blocks]);
  const { commands, files, usage } = activity;

  return (
    <aside className="inspector" aria-label={t("nav.activity")}>
      <header className="inspector-head">
        <h2>{t("nav.activity")}</h2>
        {onClose && (
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label={t("chat.activityClose")}
            title={t("chat.activityClose")}
          >
            <IconClose />
          </button>
        )}
      </header>

      <div className="inspector-meta">
        {usage.inputTokens || usage.outputTokens ? (
          <StatusBadge mono>
            ↓{formatTokens(usage.inputTokens, locale)} ↑{formatTokens(usage.outputTokens, locale)}
          </StatusBadge>
        ) : null}
        {duration ? <StatusBadge mono>{duration}</StatusBadge> : null}
      </div>

      <SegmentedControl
        label={t("nav.activity")}
        value={tab}
        onChange={setTab}
        options={[
          { value: "commands", label: `${t("activity.commands")} ${commands.length}` },
          { value: "files", label: `${t("activity.files")} ${files.length}` },
        ]}
      />

      <div className="inspector-body">
        {tab === "commands" && (
          <ul className="activity-list">
            {commands.length === 0 && <li className="muted activity-empty">{t("activity.emptyCommands")}</li>}
            {commands.map((c) => (
              <li key={c.id}>
                <button type="button" className="activity-row" onClick={() => revealBlock(c.id)} title={c.command}>
                  <span className="activity-glyph" aria-hidden="true">
                    <IconTerminal />
                  </span>
                  <code className="truncate">{c.command}</code>
                  <span className={`tool-state ${c.status}`}>
                    {c.status === "running" ? (
                      <IconSpinner />
                    ) : c.status === "done" ? (
                      <IconCheck />
                    ) : c.status === "denied" ? (
                      <IconAlert />
                    ) : (
                      <IconError />
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {tab === "files" && (
          <ul className="activity-list">
            {files.length === 0 && <li className="muted activity-empty">{t("activity.emptyFiles")}</li>}
            {files.map((f) => (
              <li key={f.path}>
                <div className="activity-file">
                  <button type="button" className="activity-row" onClick={() => revealBlock(f.id)} title={f.path}>
                    <span className="activity-glyph" aria-hidden="true">
                      {f.changed ? <IconFileEdit /> : <IconFile />}
                    </span>
                    <span className="truncate">{truncateMiddle(f.path, 34)}</span>
                    {f.add || f.del ? (
                      <span className="stats">
                        <span className="add">+{f.add}</span> <span className="del">−{f.del}</span>
                      </span>
                    ) : (
                      <span className="activity-touches nums">{f.touches}</span>
                    )}
                  </button>
                  {f.diff && (
                    <Disclosure
                      open={openFile === f.path}
                      onToggle={() => setOpenFile((cur) => (cur === f.path ? null : f.path))}
                      summary={<span>{t("activity.diff")}</span>}
                    >
                      <div className="diff">
                        <Hunk hunk={f.diff} emptyLabel={t("diff.hunks")} />
                      </div>
                    </Disclosure>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
