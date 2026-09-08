import { useMemo, useState } from "react";
import { useT } from "../i18n";
import type { ToolBlock } from "../transcript";

export function ToolCard({ block, shellLines, showDiff }: { block: ToolBlock; shellLines: number; showDiff: boolean }) {
  const t = useT();
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? (block.status === "running" || block.toolKind !== "shell");
  const hunks = useMemo(() => (showDiff && block.diff ? splitHunks(block.diff) : []), [block.diff, showDiff]);

  return (
    <article className={`tool ${block.status}`}>
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
      {open && (
        <div className="tool-body">
          {block.command && block.toolKind === "shell" && <pre className="shell-cmd">{block.command}</pre>}
          {block.chunk && (
            <pre className="shell-out">{tail(block.chunk, shellLines)}</pre>
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
