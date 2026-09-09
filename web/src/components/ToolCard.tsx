import { useMemo, useState, type ReactNode } from "react";
import { useT } from "../i18n";
import type { ToolBlock } from "../transcript";
import {
  IconAlert,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconError,
  IconFile,
  IconFileEdit,
  IconFolder,
  IconSearch,
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

function StatusPill({ status, label }: { status: string; label: string }) {
  const glyph =
    status === "running" ? null : status === "done" ? <IconCheck /> : status === "denied" ? <IconAlert /> : <IconError />;
  return (
    <span className={`pill ${status}`}>
      {glyph}
      {label}
    </span>
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
    <article className={`tool ${block.status}`}>
      <div className="tool-head-row">
        <button className="tool-head" type="button" aria-expanded={open} onClick={() => setUserOpen((v) => !(v ?? open))}>
          <span className="tool-glyph tool-disclosure" aria-hidden="true">
            {open ? <IconChevronDown /> : <IconChevronRight />}
          </span>
          <span className="tool-glyph tool-kind-glyph" title={label(block.toolKind, t)}>
            {KIND_GLYPH[block.toolKind] ?? <IconTerminal />}
            <span className="visually-hidden kind">{label(block.toolKind, t)}</span>
          </span>
          <span className="title">
            <span>{block.title}</span>
            {block.path && block.path !== block.title ? <span className="tool-path">{block.path}</span> : null}
          </span>
          {block.stats && (
            <span className="stats">
              <span className="add">+{block.stats.add}</span> <span className="del">−{block.stats.del}</span>
            </span>
          )}
          <StatusPill status={block.status} label={statusLabel} />
        </button>
        {/* The slot is always here, even with nothing in it: when the copy button
            only rendered for shell calls, the status pill landed 38px further
            left on those cards than on file reads. */}
        <span className="tool-action">
          {block.command && (
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
          )}
        </span>
      </div>
      {open && (
        <div className="tool-body">
          {block.command && block.toolKind === "shell" && <pre className="shell-cmd">{block.command}</pre>}
          {block.chunk && <pre className="shell-out">{expanded ? block.chunk : tail(block.chunk, shellLines)}</pre>}
          {canExpand && (
            <button type="button" className="ghost tiny" onClick={() => setExpanded((v) => !v)}>
              {expanded ? t("tool.showLess") : t("tool.showMore")}
            </button>
          )}
          {block.outputPreview && block.toolKind !== "shell" && <pre className="preview">{block.outputPreview}</pre>}
          {block.error && <p className="error-text">{block.error}</p>}
          {block.truncated && <p className="warn">{t("tool.truncated")}</p>}
          {hunks.map((hunk, i) => (
            <Hunk key={i} hunk={hunk} emptyLabel={t("diff.hunks")} />
          ))}
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

function Hunk({ hunk, emptyLabel }: { hunk: string; emptyLabel: string }) {
  const [open, setOpen] = useState(true);
  const lines = hunk.split("\n");
  const header = lines[0] ?? "";
  const hasHeader = header.startsWith("@@");
  /* The header already sits in the toggle; repeating it inside the block made
     every hunk render its @@ line twice. */
  const body = hasHeader ? lines.slice(1) : lines;
  return (
    <div className="hunk">
      <button type="button" className="hunk-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? <IconChevronDown /> : <IconChevronRight />}
        {hasHeader ? header : emptyLabel}
      </button>
      {open && (
        <pre className="diff">
          {body.map((line, i) => (
            <span
              key={i}
              className={
                line.startsWith("+") && !line.startsWith("+++")
                  ? "add"
                  : line.startsWith("-") && !line.startsWith("---")
                    ? "del"
                    : ""
              }
            >
              {line}
              {"\n"}
            </span>
          ))}
        </pre>
      )}
    </div>
  );
}
