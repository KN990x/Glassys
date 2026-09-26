import { useState } from "react";
import type { AdapterCapabilities, RedactedConfig } from "@glassys/protocol";
import { api } from "../api";
import { useT } from "../i18n";
import { optionBool, optionString, setAutoRun, setOption, setPermissionMode } from "../adapterOptions";
import { operatorError } from "../operatorError";
import { useConfirm } from "./ConfirmDialog";
import { PopAnchor, Popover } from "./Popover";
import { SegmentedControl } from "./SegmentedControl";
import { Switch } from "./Switch";
import { Callout } from "./Primitives";
import { IconShield, IconShieldAlert, IconShieldOff } from "./Icon";

/** How much this host is exposed right now, in one glyph. */
export function riskTone(input: { autoRun: boolean; sandbox: boolean; sandboxSupported: boolean }): "ok" | "warn" | "danger" {
  if (!input.autoRun) return "ok";
  if (input.sandboxSupported && input.sandbox) return "warn";
  return "danger";
}

export function PermissionChip({
  config,
  caps,
  onConfig,
}: {
  config: RedactedConfig;
  caps?: AdapterCapabilities;
  onConfig: (c: RedactedConfig) => void;
}) {
  const t = useT();
  const { confirm, confirmDialog } = useConfirm();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const visible = Boolean(
    caps?.sandbox || caps?.autoRun || caps?.toolConfirmation === "permission-mode" || caps?.toolConfirmation === "none",
  );

  if (!caps || !visible) return null;

  const autoRun = optionBool(config.agent.options, "autoRun", true);
  const sandbox = optionBool(config.agent.options, "sandbox", false);
  const mode = optionString(config.agent.options, "permissionMode", autoRun ? "bypassPermissions" : "dontAsk");
  const label =
    caps.toolConfirmation === "auto-review-deny"
      ? autoRun
        ? t("chip.autoRunOn")
        : t("chip.autoReview")
      : caps.toolConfirmation === "permission-mode"
        ? t(`wizard.exec.permission.${mode === "dontAsk" ? "dontAsk" : mode === "acceptEdits" ? "acceptEdits" : "bypass"}`)
        : t("chip.unattended");
  const sandboxPart = caps.sandbox ? (sandbox ? t("chip.sandboxOn") : t("chip.sandboxOff")) : "";
  const tone = riskTone({ autoRun, sandbox, sandboxSupported: Boolean(caps.sandbox) });
  const glyph = tone === "ok" ? <IconShield /> : tone === "warn" ? <IconShieldAlert /> : <IconShieldOff />;

  async function patch(options: Record<string, unknown>) {
    if (!(await confirm({ title: t("confirm.titleArchive"), message: t("chip.archiveConfirm"), confirmLabel: t("confirm.archive"), kind: "archive" }))) return;
    try {
      setError("");
      onConfig(await api.saveConfig({ agent: { options } }));
    } catch (err) {
      setError(operatorError(err instanceof Error ? err.message : t("chat.modelFailed"), t));
    }
  }

  return (
    <PopAnchor>
      <button
        type="button"
        className={`ghost tiny chip-btn risk-${tone}`}
        aria-expanded={open}
        aria-controls="permission-chip-pop"
        aria-label={sandboxPart ? `${label} · ${sandboxPart}` : label}
        title={sandboxPart ? `${label} · ${sandboxPart}` : label}
        onClick={() => setOpen((v) => !v)}
      >
        {glyph}
        <span className="truncate chip-label">{label}</span>
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        label={t("wizard.step.execution")}
        id="permission-chip-pop"
        side="top"
        align="start"
        wide
      >
        <div className="pop-section">
          <p className="eyebrow">{t("wizard.step.execution")}</p>
          {caps.sandbox && (
            <Switch
              checked={sandbox}
              label={t("wizard.exec.sandbox")}
              onChange={(next) => void patch(setOption(config.agent.options, "sandbox", next))}
            />
          )}
          {caps.autoRun && (
            <Switch
              checked={autoRun}
              label={t("wizard.exec.autoRun")}
              onChange={(next) => void patch(setAutoRun(config.agent.options, next, caps.toolConfirmation))}
            />
          )}
          {caps.toolConfirmation === "permission-mode" && (
            <SegmentedControl
              size="sm"
              label={t("wizard.exec.permissionMode")}
              value={mode === "dontAsk" ? "dontAsk" : mode === "acceptEdits" ? "acceptEdits" : "bypassPermissions"}
              onChange={(next) => void patch(setPermissionMode(config.agent.options, next))}
              options={[
                { value: "bypassPermissions", label: t("wizard.exec.permission.bypass") },
                { value: "acceptEdits", label: t("wizard.exec.permission.acceptEdits") },
                { value: "dontAsk", label: t("wizard.exec.permission.dontAsk") },
              ]}
            />
          )}
        </div>
        {caps.toolConfirmation === "auto-review-deny" && (
          <Callout tone={tone === "danger" ? "warn" : "neutral"}>{t("wizard.exec.danger")}</Callout>
        )}
        {caps.toolConfirmation === "none" && <Callout tone="warn">{t("wizard.exec.unattended")}</Callout>}
        {error && <Callout tone="danger">{error}</Callout>}
      </Popover>
      {confirmDialog}
    </PopAnchor>
  );
}
