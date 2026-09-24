import { useState, type ReactNode } from "react";
import type { MessageAttachment, PromptTemplate, QueueItem } from "@glassys/protocol";
import type { Block, ToolBlock } from "../transcript";
import { useT } from "../i18n";
import { formatTokens, isImageMime } from "../format";
import { operatorError } from "../operatorError";
import { MarkdownBody } from "./MarkdownBody";
import { Thinking } from "./Thinking";
import { ToolGroup } from "./ToolCard";
import { Skeleton } from "./Primitives";
import {
  GlassysMark,
  IconActivity,
  IconAlert,
  IconCheck,
  IconCopy,
  IconDisk,
  IconError,
  IconInfo,
  IconLogs,
  IconZap,
} from "./Icon";

const CHIP_GLYPH: Record<string, ReactNode> = {
  status: <IconActivity />,
  disk: <IconDisk />,
  "failed-units": <IconAlert />,
  logs: <IconLogs />,
  journal: <IconLogs />,
};

/** Consecutive tool calls travel together, everything else stands alone. */
export function groupBlocks(blocks: Block[]): Array<Block | { kind: "tools"; id: string; blocks: ToolBlock[] }> {
  const out: Array<Block | { kind: "tools"; id: string; blocks: ToolBlock[] }> = [];
  for (const b of blocks) {
    if (b.kind !== "tool") {
      out.push(b);
      continue;
    }
    const last = out[out.length - 1];
    if (last && "kind" in last && last.kind === "tools") {
      last.blocks.push(b);
      continue;
    }
    out.push({ kind: "tools", id: `g-${b.id}`, blocks: [b] });
  }
  return out;
}

/** Search hits are marked in plain text; a markdown body keeps its own markup. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const parts: ReactNode[] = [];
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  let i = 0;
  let n = 0;
  while (i < text.length) {
    const hit = lower.indexOf(needle, i);
    if (hit === -1) {
      parts.push(text.slice(i));
      break;
    }
    if (hit > i) parts.push(text.slice(i, hit));
    parts.push(<mark key={`m${n++}`}>{text.slice(hit, hit + needle.length)}</mark>);
    i = hit + needle.length;
  }
  return <>{parts}</>;
}

function CopyTurn({ text }: { text: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="icon-btn sm turn-copy"
      aria-label={t("chat.copy")}
      title={copied ? t("chat.copied") : t("chat.copy")}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => undefined,
        );
      }}
    >
      {copied ? <IconCheck /> : <IconCopy />}
    </button>
  );
}

export type TranscriptProps = {
  blocks: Block[];
  allBlocks: Block[];
  snapshotReady: boolean;
  connecting: boolean;
  search: string;
  queuedIds: Set<string>;
  locale: string;
  thinkingDefault: "collapsed" | "expanded";
  shellLines: number;
  showDiff: boolean;
  opsChips: PromptTemplate[];
  onTemplate: (text: string) => void;
  hostLabel: string;
  cwd: string;
  adapterName: string;
  queue: QueueItem[];
};

export function Transcript({
  blocks,
  allBlocks,
  snapshotReady,
  connecting,
  search,
  queuedIds,
  locale,
  thinkingDefault,
  shellLines,
  showDiff,
  opsChips,
  onTemplate,
  hostLabel,
  cwd,
  adapterName,
}: TranscriptProps) {
  const t = useT();
  const grouped = groupBlocks(blocks);

  return (
    <>
      {!snapshotReady && (
        <div className="empty" aria-live="polite">
          <Skeleton label={t(connecting ? "status.connecting" : "status.reconnecting")} />
        </div>
      )}
      {allBlocks.length === 0 && snapshotReady && !search.trim() && (
        <div className="empty empty-state">
          <GlassysMark size={32} />
          <h2>{t("chat.emptyTitle")}</h2>
          <p className="empty-host">{[hostLabel, cwd, adapterName].filter(Boolean).join(" · ")}</p>
          {opsChips.length > 0 && (
            /* A list, not a grid of cards: three suggestions in a two-column grid
               always left an orphan, and a list reads the same at every width. */
            <div className="empty-actions" role="group" aria-label={t("chat.opsChips")}>
              {opsChips.map((tpl) => (
                <button key={tpl.id} type="button" className="empty-action" onClick={() => onTemplate(tpl.text)}>
                  <span className="empty-action-glyph" aria-hidden="true">
                    {CHIP_GLYPH[tpl.id] ?? CHIP_GLYPH[tpl.slash.replace(/^\//, "")] ?? <IconZap />}
                  </span>
                  <strong className="truncate">
                    {t(`prompt.${tpl.id}`) === `prompt.${tpl.id}` ? tpl.title : t(`prompt.${tpl.id}`)}
                  </strong>
                  <span className="empty-action-slash">{tpl.slash.startsWith("/") ? tpl.slash : `/${tpl.slash}`}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {search.trim() && blocks.length === 0 && allBlocks.length > 0 && (
        <p className="empty">{t("chat.searchEmpty")}</p>
      )}
      {grouped.map((item) => {
        if ("kind" in item && item.kind === "tools") {
          return <ToolGroup key={item.id} blocks={item.blocks} shellLines={shellLines} showDiff={showDiff} />;
        }
        const b = item as Block;
        if (b.kind === "user") {
          const pending = Boolean(b.messageId && queuedIds.has(b.messageId));
          return (
            <div key={b.id} className={`bubble user${b.retracted ? " retracted" : ""}${pending ? " pending" : ""}`}>
              {b.attachments && b.attachments.length > 0 && <Thumbs attachments={b.attachments} />}
              <Highlight text={b.text} query={search} />
              {pending && <span className="muted bubble-flag">{t("chat.pending")}</span>}
              {b.retracted && <span className="muted bubble-flag">{t("chat.retracted")}</span>}
            </div>
          );
        }
        if (b.kind === "thinking") {
          return (
            <Thinking
              key={b.id}
              text={b.text}
              durationMs={b.durationMs}
              defaultOpen={thinkingDefault === "expanded"}
            />
          );
        }
        if (b.kind === "text") {
          return (
            <div key={b.id} className="bubble assistant">
              <MarkdownBody text={b.text} />
              <div className="turn-foot">
                <CopyTurn text={b.text} />
              </div>
            </div>
          );
        }
        if (b.kind === "usage") {
          const parts = [
            b.inputTokens != null ? `↓${formatTokens(b.inputTokens, locale)}` : "",
            b.outputTokens != null ? `↑${formatTokens(b.outputTokens, locale)}` : "",
          ].filter(Boolean);
          if (!parts.length) return null;
          return (
            <p key={b.id} className="muted usage" title={t("chat.usageTotal")}>
              {t("chat.usage")} {parts.join(" ")}
            </p>
          );
        }
        if (b.kind === "banner") {
          const text =
            b.text === "cancelled"
              ? t("status.cancelled")
              : b.text === "stalled"
                ? t("chat.stalled")
                : operatorError(b.text, t);
          const tone = b.text === "stalled" ? "warn" : b.tone;
          return (
            <p
              key={b.id}
              className={`banner ${tone}`}
              role={tone === "error" ? "alert" : "status"}
            >
              <span className="banner-icon" aria-hidden="true">
                {tone === "error" ? <IconError /> : tone === "warn" ? <IconAlert /> : <IconInfo />}
              </span>
              {text}
            </p>
          );
        }
        return null;
      })}
    </>
  );
}

function Thumbs({ attachments }: { attachments: MessageAttachment[] }) {
  return (
    <div className="thumbs">
      {attachments.map((a) =>
        isImageMime(a.mime) ? (
          <img key={a.id} src={`/api/uploads/${encodeURIComponent(a.id)}`} alt={a.name} />
        ) : (
          <span key={a.id} className="file-chip">
            {a.name}
          </span>
        ),
      )}
    </div>
  );
}
