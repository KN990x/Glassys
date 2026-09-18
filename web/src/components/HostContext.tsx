import { useState } from "react";
import { useT } from "../i18n";
import { truncateMiddle } from "../format";
import { IconCheck, IconCopy, IconServer } from "./Icon";

export type HostInfo = {
  hostLabel: string;
  cwd: string;
  git?: { branch: string; dirty: boolean };
  adapter: string;
};

/**
 * Which machine this is. The rail shows one card — four 11px labelled rows of
 * icons took more height than the thread list they sat under. The phone topbar
 * keeps the single clipped line; both copy the cwd on click.
 */
export function HostContext({
  info,
  variant,
  onCopyFailed,
}: {
  info: HostInfo;
  variant: "card" | "inline";
  onCopyFailed: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  function copy() {
    if (!info.cwd) return;
    void navigator.clipboard.writeText(info.cwd).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      onCopyFailed,
    );
  }

  const branch = info.git ? `${info.git.branch}${info.git.dirty ? ` (${t("chat.gitDirty")})` : ""}` : "";

  if (variant === "inline") {
    return (
      <span className="host-context muted">
        <button
          type="button"
          className="host-copy"
          title={info.cwd}
          aria-label={t("chat.copyCwd")}
          onClick={copy}
        >
          {[info.hostLabel, info.cwd, branch, info.adapter].filter(Boolean).join(" · ")}
          {copied ? ` · ${t("chat.copied")}` : ""}
        </button>
      </span>
    );
  }

  return (
    <div className="host-context host-card">
      <span className="host-glyph" aria-hidden="true">
        <IconServer />
      </span>
      <div className="host-lines">
        <span className="host-name truncate" title={info.hostLabel}>
          {info.hostLabel || t("host.machine")}
        </span>
        <span className="host-detail truncate" title={[info.cwd, branch].filter(Boolean).join(" · ")}>
          {truncateMiddle(info.cwd, 26) || "—"}
          {branch ? ` · ${branch}` : ""}
        </span>
      </div>
      <button
        type="button"
        className="icon-btn sm host-copy-btn"
        onClick={copy}
        aria-label={t("chat.copyCwd")}
        title={copied ? t("chat.copied") : t("chat.copyCwd")}
      >
        {copied ? <IconCheck /> : <IconCopy />}
      </button>
    </div>
  );
}
