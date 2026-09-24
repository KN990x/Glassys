import { useState } from "react";
import { useT } from "../i18n";
import { truncateMiddle } from "../format";
import { IconServer } from "./Icon";

export type HostInfo = {
  hostLabel: string;
  cwd: string;
  git?: { branch: string; dirty: boolean };
  adapter: string;
};

/**
 * Which machine this is. The rail's foot names the machine and the agent in one
 * row — the workspace path belongs to the thread and lives in the topbar, where
 * it used to be repeated. The phone topbar keeps the single clipped line, and
 * both line forms copy the cwd on click.
 */
export function HostContext({
  info,
  variant,
  onCopyFailed,
}: {
  info: HostInfo;
  variant: "rail" | "inline" | "path";
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

  if (variant === "rail") {
    return (
      <div className="host-context host-rail" title={[info.hostLabel, info.adapter].filter(Boolean).join(" · ")}>
        <span className="host-glyph" aria-hidden="true">
          <IconServer />
        </span>
        <span className="host-lines">
          <span className="host-name truncate">{info.hostLabel || t("host.machine")}</span>
          <span className="host-detail truncate">{info.adapter || "—"}</span>
        </span>
      </div>
    );
  }

  const parts =
    variant === "path"
      ? [truncateMiddle(info.cwd, 56), branch]
      : [info.hostLabel, info.cwd, branch, info.adapter];

  return (
    <span className={`host-context muted${variant === "path" ? " host-path" : ""}`}>
      <button
        type="button"
        className="host-copy"
        title={copied ? t("chat.copied") : `${t("chat.copyCwd")}: ${info.cwd}`}
        aria-label={t("chat.copyCwd")}
        onClick={copy}
      >
        {parts.filter(Boolean).join(" · ")}
        {copied ? ` · ${t("chat.copied")}` : ""}
      </button>
    </span>
  );
}
