import { useMemo, useState, type ReactNode } from "react";
import { useT } from "../i18n";
import type { ToolBlock } from "../transcript";
import {
  IconAlert,
  IconCheck,
  IconChevronRight,
  IconCopy,
  IconError,
  IconFile,
  IconFileEdit,
  IconFolder,
  IconSearch,
  IconSpinner,
  IconTerminal,
} from "./Icon";

const KIND_GLYPH: Record<string, ReactNode> = {
  shell: <IconTerminal />,
  read: <IconFile />,
  write: <IconFileEdit />,
  edit: <IconFileEdit />,
  grep: <IconSearch />,
  glob: <IconSearch />,
  semsearch: <IconSearch />,
  ls: <IconFolder />,
};

/** A step that worked is not news. Only trouble gets a colour and a word. */
function ToolState({ status, label }: { status: string; label: string }) {
  if (status === "running") {
    return (
      <span className="tool-state running" title={label}>
        <IconSpinner />
        <span className="visually-hidden">{label}</span>
      </span>
    );
  }
  if (status === "done") {
    return (
      <span className="tool-state done" title={label}>
        <IconCheck />
        <span className="visually-hidden">{label}</span>
      </span>
    );
  }
  return (
    <span className={`tool-state ${status}`}>
      {status === "denied" ? <IconAlert /> : <IconError />}
      {label}
    </span>
  );
}

export function toolGroupSummary(blocks: ToolBlock[]): { files: number; add: number; del: number } {
  const files = new Set<string>();
  let add = 0;
  let del = 0;
  for (const b of blocks) {
    if (b.path) files.add(b.path);
    add += b.stats?.add ?? 0;
    del += b.stats?.del ?? 0;
  }
  return { files: files.size, add, del };
}

/** Anything unfinished or unhappy opens itself; a long clean run stays folded. */
export function groupOpensByDefault(blocks: ToolBlock[], showDiff: boolean): boolean {
  if (blocks.some((b) => b.status === "running" || b.status === "error" || b.status === "denied")) return true;
  if (showDiff && blocks.some((b) => b.diff)) return true;
  return blocks.length <= 3;
}

/**
 * Consecutive calls collapse into one band. A run that touched a dozen files
 * used to be a dozen bordered cards, each 64px tall, between the question and
 * the answer.
 */
export function ToolGroup({
  blocks,
  shellLines,
  showDiff,
}: {
  blocks: ToolBlock[];
  shellLines: number;
  showDiff: boolean;
}) {
  const t = useT();
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? groupOpensByDefault(blocks, showDiff);
  const { files, add, del } = useMemo(() => toolGroupSummary(blocks), [blocks]);
  const running = blocks.some((b) => b.status === "running");
  const failed = blocks.some((b) => b.status === "error" || b.status === "denied");
  /* Open, a group whose changes all sit in one row would print that row's
     totals twice; the head keeps them when folded or when they add up. */
  const statRows = blocks.filter((b) => b.stats).length;
  const showTotals = Boolean(add || del) && (!open || statRows > 1);

  if (blocks.length === 1) {
    return <ToolCard block={blocks[0]!} shellLines={shellLines} showDiff={showDiff} />;
  }

  return (
    <section className={`tool-group${open ? " open" : ""}${failed ? " failed" : ""}`}>
      {/* The head carries the same tail as a row — stats, state, action slot —
          so the group's totals and state sit in the rows' own columns. */}
      <div className="tool-row tool-group-row">
        <button
          type="button"
          className="tool-group-head"
          aria-expanded={open}
          onClick={() => setUserOpen((v) => !(v ?? open))}
        >
          <span className="tool-chevron" aria-hidden="true">
            <IconChevronRight />
          </span>
          <span className="tool-group-title nums">
            {blocks.length} {t("tool.steps")}
            {files > 0 ? ` · ${files} ${t("tool.files")}` : ""}
          </span>
        </button>
        <span className="tool-tail">
          {showTotals ? (
            <span className="stats">
              <span className="add">+{add}</span> <span className="del">−{del}</span>
            </span>
          ) : null}
          <ToolState
            status={running ? "running" : failed ? "error" : "done"}
            label={running ? t("tool.running") : failed ? t("tool.error") : t("tool.done")}
          />
        </span>
      </div>
      {open && (
        <div className="tool-group-body">
          {blocks.map((b) => (
            <ToolCard key={b.id} block={b} shellLines={shellLines} showDiff={showDiff} />
          ))}
        </div>
      )}
    </section>
  );
}

export function ToolCard({ block, shellLines, showDiff }: { block: ToolBlock; shellLines: number; showDiff: boolean }) {
  const t = useT();
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  /* Reads and greps used to open by default, so a run that touched a dozen
     files buried the answer. Only unfinished, failed and diff-bearing calls
     open themselves now. */
  const open =
    userOpen ??
    (block.status === "running" || block.status === "error" || block.status === "denied" || Boolean(showDiff && block.diff));
  const hunks = useMemo(() => (showDiff && block.diff ? splitHunks(block.diff) : []), [block.diff, showDiff]);
  const chunkLines = block.chunk ? block.chunk.split("\n").length : 0;
  const canExpand = chunkLines > shellLines;

  async function copyCommand(e: { stopPropagation: () => void }) {
    e.stopPropagation();
    if (!block.command) return;
    try {
      await navigator.clipboard.writeText(block.command);
      setCopyFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  }

  const statusLabel =
    block.status === "running"
      ? t("tool.running")
      : block.status === "denied"
        ? t("tool.denied")
        : block.status === "error"
          ? t("tool.error")
          : t("tool.done");

  return (
    <article className={`tool ${block.status}`} id={`tool-${block.id}`}>
      <div className="tool-row">
        <button className="tool-head" type="button" aria-expanded={open} onClick={() => setUserOpen((v) => !(v ?? open))}>
          {/* One glyph column: the kind at rest, the chevron under the pointer
              or the focus ring. Chevron and kind side by side were two icons
              before every title. */}
          <span className="tool-glyph" title={label(block.toolKind, t)}>
            <span className="tool-kind-glyph">{KIND_GLYPH[block.toolKind] ?? <IconTerminal />}</span>
            <span className={`tool-chevron${open ? " open" : ""}`} aria-hidden="true">
              <IconChevronRight />
            </span>
            <span className="visually-hidden kind">{label(block.toolKind, t)}</span>
          </span>
          {/* A command is set in the face it runs in, as it is in the output
              under it and in the Activity panel. */}
          <span className={`title${block.toolKind === "shell" ? " command" : ""}`}>
            <span>{block.title}</span>
            {block.path && block.path !== block.title ? <span className="tool-path">{block.path}</span> : null}
          </span>
        </button>
        <span className="tool-tail">
          {block.stats && (
            <span className="stats">
              <span className="add">+{block.stats.add}</span> <span className="del">−{block.stats.del}</span>
            </span>
          )}
          <ToolState status={block.status} label={statusLabel} />
        </span>
        {/* Copy lays over the state on hover instead of reserving a column: the
            empty slot left every row's tail 30px short of the right edge. */}
        {block.command && (
          <span className="tool-copy-slot">
            <button
              type="button"
              className={`icon-btn sm tool-copy${copyFailed ? " failed" : ""}`}
              aria-label={t("tool.copyCommand")}
              title={t("tool.copyCommand")}
              onClick={(e) => void copyCommand(e)}
            >
              {copied ? <IconCheck /> : copyFailed ? <IconAlert /> : <IconCopy />}
              {/* The label left the button face, so the outcome is announced instead. */}
              <span className="visually-hidden" aria-live="polite">
                {copied ? t("chat.copied") : copyFailed ? t("chat.copyFailed") : t("tool.copyCommand")}
              </span>
            </button>
          </span>
        )}
      </div>
      {open && (
        <div className="tool-body">
          {block.command && block.toolKind === "shell" ? (
            <div className="term">
              <div className="term-line">
                <span className="term-prompt" aria-hidden="true">
                  $
                </span>
                <code>{block.command}</code>
              </div>
              {block.chunk && (
                <pre className="shell-out">{expanded ? block.chunk : tail(block.chunk, shellLines)}</pre>
              )}
            </div>
          ) : (
            block.chunk && <pre className="shell-out">{expanded ? block.chunk : tail(block.chunk, shellLines)}</pre>
          )}
          {canExpand && (
            <button type="button" className="ghost tiny" onClick={() => setExpanded((v) => !v)}>
              {expanded ? t("tool.showLess") : t("tool.showMore")}
            </button>
          )}
          {block.outputPreview && block.toolKind !== "shell" && <pre className="preview">{block.outputPreview}</pre>}
          {/* The head already says denied or error, in red with its glyph; the
              reason reads in grey under it rather than saying so again. */}
          {block.error && <p className="tool-error">{block.error}</p>}
          {block.truncated && <p className="warn">{t("tool.truncated")}</p>}
          {hunks.length > 0 && (
            <div className="diff">
              {hunks.map((hunk, i) => (
                <Hunk key={i} hunk={hunk} emptyLabel={t("diff.hunks")} />
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function label(kind: string, t: (key: string) => string): string {
  const key = `tool.kind.${kind}`;
  const translated = t(key);
  return translated === key ? kind : translated;
}

function tail(text: string, lines: number): string {
  const parts = text.split("\n");
  if (parts.length <= lines) return text;
  return parts.slice(-lines).join("\n");
}

function splitHunks(diff: string): string[] {
  const parts = diff.split(/(?=^@@)/m).filter((p) => p.trim());
  return parts.length ? parts : [diff];
}

/** "@@ -12,6 +12,7 @@" gives the first old and new line of a hunk. */
export function hunkStart(header: string): { old: number; new: number } | null {
  const m = header.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  return m ? { old: Number(m[1]), new: Number(m[2]) } : null;
}

export function Hunk({ hunk, emptyLabel }: { hunk: string; emptyLabel: string }) {
  const [open, setOpen] = useState(true);
  const lines = hunk.split("\n");
  const header = lines[0] ?? "";
  const hasHeader = header.startsWith("@@");
  /* The header already sits in the toggle; repeating it inside the block made
     every hunk render its @@ line twice. */
  const body = hasHeader ? lines.slice(1) : lines;
  // A diff that ends in a newline splits into a last empty "line" that is not one.
  if (body.length > 1 && body[body.length - 1] === "") body.pop();
  const start = hasHeader ? hunkStart(header) : null;
  let oldNo = start?.old ?? 0;
  let newNo = start?.new ?? 0;
  const rows = body.map((line) => {
    const added = line.startsWith("+") && !line.startsWith("+++");
    const removed = line.startsWith("-") && !line.startsWith("---");
    const row = {
      line,
      added,
      removed,
      oldNo: start && !added ? oldNo : null,
      newNo: start && !removed ? newNo : null,
    };
    if (!added) oldNo++;
    if (!removed) newNo++;
    return row;
  });
  return (
    <div className="hunk">
      <button type="button" className="hunk-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className={`tool-chevron${open ? " open" : ""}`} aria-hidden="true">
          <IconChevronRight />
        </span>
        {hasHeader ? header : emptyLabel}
      </button>
      {open && (
        <div className={`diff-body${start ? " numbered" : ""}`}>
          {rows.map(({ line, added, removed, oldNo: o, newNo: n }, i) => (
            <div key={i} className={`diff-line${added ? " add" : removed ? " del" : ""}`}>
              {start ? (
                <>
                  <span className="diff-no" aria-hidden="true">{o ?? ""}</span>
                  <span className="diff-no" aria-hidden="true">{n ?? ""}</span>
                </>
              ) : null}
              <span className="diff-sign" aria-hidden="true">
                {added ? "+" : removed ? "−" : ""}
              </span>
              {/* Context lines carry a leading space in unified diff, the same column
                  as the + and −; keeping it pushed them one character right. */}
              <code className="diff-code">{added || removed || line.startsWith(" ") ? line.slice(1) : line}</code>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
