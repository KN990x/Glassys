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
 * it used to be repeated. The topbar's form copies the cwd on click.
 */
export function HostContext({
  info,
  variant,
  onCopyFailed,
}: {
  info: HostInfo;
  variant: "rail" | "path";
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

  // The thread's path and branch, in the face paths are set in everywhere
  // else. A dirty tree is the rail's amber dot, not a word in brackets.
  return (
    <span className="host-context muted host-path">
      <button
        type="button"
        className="host-copy"
        title={copied ? t("chat.copied") : `${t("chat.copyCwd")}: ${info.cwd}`}
        aria-label={t("chat.copyCwd")}
        onClick={copy}
      >
        {truncateMiddle(info.cwd, 56)}
        {info.git ? (
          <>
            {" · "}
            <span className={`host-branch${info.git.dirty ? " dirty" : ""}`}>
              {info.git.branch}
              {info.git.dirty ? <span className="visually-hidden"> ({t("chat.gitDirty")})</span> : null}
            </span>
          </>
        ) : null}
        {copied ? ` · ${t("chat.copied")}` : ""}
      </button>
    </span>
  );
}
