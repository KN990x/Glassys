import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useT } from "../i18n";
import { IconAlert, IconCheck, IconCopy } from "./Icon";

const SAFE_HREF = /^(https?:|mailto:|#)/i;

export function safeHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  const trimmed = href.trim();
  return SAFE_HREF.test(trimmed) ? trimmed : undefined;
}

const REMARK_PLUGINS = [remarkGfm];

const COMPONENTS: Components = {
  pre({ children }) {
    return <CodeBlock language={codeLanguage(children)}>{children}</CodeBlock>;
  },
  a({ href, children }) {
    const safe = safeHref(href);
    if (!safe) return <span>{children}</span>;
    return (
      <a href={safe} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  img() {
    return null;
  },
  table({ children }) {
    /* Wide tables scroll inside themselves; the page never does. */
    return (
      <div className="table-wrap">
        <table>{children}</table>
      </div>
    );
  },
};

/* A streaming block grows by a few characters per delta; reparsing the whole
   reply on every one is what made long answers stutter. */
export const STREAM_PARSE_MS = 80;

function useThrottledText(text: string, live: boolean): string {
  const [shown, setShown] = useState(text);
  const last = useRef(0);
  useEffect(() => {
    if (!live) {
      setShown(text);
      return;
    }
    const wait = STREAM_PARSE_MS - (Date.now() - last.current);
    if (wait <= 0) {
      last.current = Date.now();
      setShown(text);
      return;
    }
    const id = setTimeout(() => {
      last.current = Date.now();
      setShown(text);
    }, wait);
    return () => clearTimeout(id);
  }, [text, live]);
  return live ? shown : text;
}

function MarkdownBodyInner({ text, live = false }: { text: string; live?: boolean }) {
  const shown = useThrottledText(text, live);
  return (
    <div className="md">
      <Markdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS}>
        {shown}
      </Markdown>
    </div>
  );
}

export const MarkdownBody = memo(MarkdownBodyInner);

/** `language-bash` on the inner <code> is how remark labels a fenced block. */
export function codeLanguage(node: ReactNode): string {
  const cls =
    node && typeof node === "object" && "props" in node
      ? ((node as { props?: { className?: string } }).props?.className ?? "")
      : "";
  const hit = /language-([a-z0-9+#-]+)/i.exec(cls);
  return hit?.[1] ?? "";
}

function CodeBlock({ children, language }: { children?: ReactNode; language?: string }) {
  const t = useT();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const text = extractText(children);
  return (
    <div className="code-wrap">
      {/* A labelled bar, so the copy control is not a text button floating over
          the first line of code with 48px of padding reserved for it. */}
      <div className="code-head">
        <span className="code-lang">{language || t("chat.code")}</span>
        <button
          className="icon-btn sm"
          type="button"
          aria-label={t("chat.copy")}
          title={copyState === "copied" ? t("chat.copied") : copyState === "failed" ? t("chat.copyFailed") : t("chat.copy")}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopyState("copied");
              setTimeout(() => setCopyState("idle"), 1200);
            } catch {
              setCopyState("failed");
              setTimeout(() => setCopyState("idle"), 1800);
            }
          }}
        >
          {copyState === "copied" ? <IconCheck /> : copyState === "failed" ? <IconAlert /> : <IconCopy />}
          <span className="visually-hidden" aria-live="polite">
            {copyState === "copied" ? t("chat.copied") : copyState === "failed" ? t("chat.copyFailed") : t("chat.copy")}
          </span>
        </button>
      </div>
      <pre>
        <code>{children}</code>
      </pre>
    </div>
  );
}

function extractText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return extractText((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return "";
}
