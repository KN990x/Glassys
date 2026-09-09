import { useState } from "react";
import { useT } from "../i18n";
import { truncateMiddle } from "../format";
import { IconFolder, IconGit, IconServer, IconTerminal } from "./Icon";

export type HostInfo = {
  hostLabel: string;
  cwd: string;
  git?: { branch: string; dirty: boolean };
  adapter: string;
};

/**
 * The rail shows one labelled row per fact. The mobile topbar has no room for
 * that, so it keeps the single clipped line — but both copy the cwd on click.
 */
export function HostContext({
  info,
  variant,
  onCopyFailed,
}: {
  info: HostInfo;
  variant: "rows" | "inline";
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
    <dl className="host-context host-rows">
      {info.hostLabel && (
        <div className="host-row">
          <dt>
            <IconServer size={14} />
            <span className="visually-hidden">{t("host.machine")}</span>
          </dt>
          <dd className="truncate" title={info.hostLabel}>
            {info.hostLabel}
          </dd>
        </div>
      )}
      <div className="host-row">
        <dt>
          <IconFolder size={14} />
          <span className="visually-hidden">{t("host.folder")}</span>
        </dt>
        <dd>
          <button type="button" className="host-copy" title={info.cwd} aria-label={t("chat.copyCwd")} onClick={copy}>
            {copied ? t("chat.copied") : truncateMiddle(info.cwd, 30) || "—"}
          </button>
        </dd>
      </div>
      {branch && (
        <div className="host-row">
          <dt>
            <IconGit size={14} />
            <span className="visually-hidden">{t("host.branch")}</span>
          </dt>
          <dd className="truncate" title={branch}>
            {branch}
          </dd>
        </div>
      )}
      <div className="host-row">
        <dt>
          <IconTerminal size={14} />
          <span className="visually-hidden">{t("host.agent")}</span>
        </dt>
        <dd className="truncate">{info.adapter}</dd>
      </div>
    </dl>
  );
}
