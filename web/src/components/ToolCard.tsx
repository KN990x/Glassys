import { useMemo, useState } from "react";
import { useT } from "../i18n";
import type { ToolBlock } from "../transcript";

export function ToolCard({ block, shellLines, showDiff }: { block: ToolBlock; shellLines: number; showDiff: boolean }) {
  const t = useT();
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const open = userOpen ?? (block.status === "running" || block.toolKind !== "shell");
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

  return (
    <article className={`tool ${block.status}`}>
      <div className="tool-head-row">
        <button className="tool-head" type="button" aria-expanded={open} onClick={() => setUserOpen((v) => !(v ?? open))}>
          <span className="kind">{label(block.toolKind, t)}</span>
          <span className="title">
            <span>{block.title}</span>
            {block.path && block.path !== block.title ? <span className="tool-path">{block.path}</span> : null}
          </span>
          {block.stats && (
            <span className="stats">
              +{block.stats.add} −{block.stats.del}
            </span>
          )}
          <span className={`pill ${block.status}`}>
            {block.status === "running"
              ? t("tool.running")
              : block.status === "denied"
                ? t("tool.denied")
                : block.status === "error"
                  ? t("tool.error")
                  : t("tool.done")}
          </span>
        </button>
        {block.command && (
          <button type="button" className="ghost tiny tool-copy" onClick={(e) => void copyCommand(e)}>
            {copied ? t("chat.copied") : copyFailed ? t("chat.copyFailed") : t("tool.copyCommand")}
          </button>
        )}
      </div>
      {open && (
        <div className="tool-body">
          {block.command && block.toolKind === "shell" && <pre className="shell-cmd">{block.command}</pre>}
          {block.chunk && (
            <pre className="shell-out">{expanded ? block.chunk : tail(block.chunk, shellLines)}</pre>
          )}
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
  const header = hunk.split("\n")[0] ?? "";
  return (
    <div className="hunk">
      <button type="button" className="hunk-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {header.startsWith("@@") ? header : emptyLabel}
      </button>
      {open && (
        <pre className="diff">
          {hunk.split("\n").map((line, i) => (
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
