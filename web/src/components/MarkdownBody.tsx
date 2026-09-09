import { memo, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useT } from "../i18n";

const SAFE_HREF = /^(https?:|mailto:|#)/i;

export function safeHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  const trimmed = href.trim();
  return SAFE_HREF.test(trimmed) ? trimmed : undefined;
}

function MarkdownBodyInner({ text }: { text: string }) {
  return (
    <div className="md">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre({ children }) {
            return <CodeBlock>{children}</CodeBlock>;
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
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}

export const MarkdownBody = memo(MarkdownBodyInner);

function CodeBlock({ children }: { children?: ReactNode }) {
  const t = useT();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const text = extractText(children);
  return (
    <div className="code-wrap">
      <button
        className="ghost tiny"
        type="button"
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
        {copyState === "copied" ? t("chat.copied") : copyState === "failed" ? t("chat.copyFailed") : t("chat.copy")}
      </button>
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
