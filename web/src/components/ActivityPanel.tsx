import { useMemo, useState } from "react";
import type { Block } from "../transcript";
import { deriveActivity } from "../activity";
import { useT } from "../i18n";
import { formatTokens, truncateMiddle } from "../format";
import { SegmentedControl } from "./SegmentedControl";
import { Disclosure, ListRow } from "./Primitives";
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

/** Every state is one 16px glyph in one column, so the rows' right edges agree. */
function StateGlyph({ status }: { status: string }) {
  return (
    <span className={`activity-state ${status}`}>
      {status === "running" ? (
        <IconSpinner />
      ) : status === "done" ? (
        <IconCheck />
      ) : status === "denied" ? (
        <IconAlert />
      ) : (
        <IconError />
      )}
    </span>
  );
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
  usage: usageOverride,
}: {
  blocks: Block[];
  onClose?: () => void;
  locale: string;
  duration?: string;
  /** The thread's stored totals, when the gateway has them. */
  usage?: { inputTokens?: number; outputTokens?: number } | null;
}) {
  const t = useT();
  const [tab, setTab] = useState<ActivityTab>("commands");
  const [openFile, setOpenFile] = useState<string | null>(null);
  const activity = useMemo(() => deriveActivity(blocks), [blocks]);
  const { commands, files } = activity;
  const usage = usageOverride ?? activity.usage;
  const hasUsage = Boolean(usage.inputTokens || usage.outputTokens);

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

      {hasUsage || duration ? (
        <dl className="inspector-stats">
          {hasUsage ? (
            <div className="stat">
              <dt>{t("activity.tokens")}</dt>
              <dd className="nums">
                {formatTokens(usage.inputTokens, locale)}
                <span className="stat-sep"> / </span>
                {formatTokens(usage.outputTokens, locale)}
              </dd>
            </div>
          ) : null}
          {duration ? (
            <div className="stat">
              <dt>{t("activity.duration")}</dt>
              <dd className="nums">{duration}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <div className="inspector-tabs">
        <SegmentedControl
          label={t("nav.activity")}
          value={tab}
          onChange={setTab}
          options={[
            { value: "commands", label: `${t("activity.commands")} ${commands.length}` },
            { value: "files", label: `${t("activity.files")} ${files.length}` },
          ]}
        />
      </div>

      <div className="inspector-body">
        {tab === "commands" && (
          <ul className="activity-list">
            {commands.length === 0 && <li className="muted activity-empty">{t("activity.emptyCommands")}</li>}
            {commands.map((c) => (
              <li key={c.id}>
                <ListRow
                  className="activity-row"
                  glyph={<IconTerminal />}
                  mono
                  title={c.command}
                  onClick={() => revealBlock(c.id)}
                  tail={<StateGlyph status={c.status} />}
                >
                  {c.command}
                </ListRow>
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
                  <ListRow
                    className="activity-row"
                    glyph={f.changed ? <IconFileEdit /> : <IconFile />}
                    mono
                    title={f.path}
                    onClick={() => revealBlock(f.id)}
                    tail={
                      f.add || f.del ? (
                        <span className="stats">
                          <span className="add">+{f.add}</span> <span className="del">−{f.del}</span>
                        </span>
                      ) : (
                        <span className="activity-touches nums">{f.touches}×</span>
                      )
                    }
                  >
                    {truncateMiddle(f.path, 34)}
                  </ListRow>
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

