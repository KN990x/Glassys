import { useEffect, useRef, useState } from "react";
import type { AdapterCapabilities, RedactedConfig } from "@glassys/protocol";
import { api } from "../api";
import { useT } from "../i18n";
import { optionBool, optionString, setAutoRun, setOption, setPermissionMode } from "../adapterOptions";
import { operatorError } from "../operatorError";

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
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const wrap = useRef<HTMLDivElement>(null);
  const visible = Boolean(caps?.sandbox || caps?.autoRun || caps?.toolConfirmation === "permission-mode");

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!caps || !visible) return null;

  const autoRun = optionBool(config.agent.options, "autoRun", true);
  const sandbox = optionBool(config.agent.options, "sandbox", false);
  const mode = optionString(config.agent.options, "permissionMode", autoRun ? "bypassPermissions" : "dontAsk");
  const label = caps.toolConfirmation === "auto-review-deny"
    ? autoRun
      ? t("chip.autoRunOn")
      : t("chip.autoReview")
    : caps.toolConfirmation === "permission-mode"
      ? t(`wizard.exec.permission.${mode === "dontAsk" ? "dontAsk" : mode === "acceptEdits" ? "acceptEdits" : "bypass"}`)
      : t("chip.unattended");

  async function patch(options: Record<string, unknown>) {
    if (!window.confirm(t("chip.archiveConfirm"))) return;
    try {
      setError("");
      onConfig(await api.saveConfig({ agent: { options } }));
    } catch (err) {
      setError(operatorError(err instanceof Error ? err.message : t("chat.modelFailed"), t));
    }
  }

  return (
    <div className="chip-wrap" ref={wrap}>
      <button type="button" className="ghost tiny" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {sandbox ? `${label} · ${t("wizard.exec.sandbox")}` : label}
      </button>
      {open && (
        <div className="chip-pop">
          {caps.sandbox && (
            <label className="choice">
              <input
                type="checkbox"
                checked={sandbox}
                onChange={(e) => void patch(setOption(config.agent.options, "sandbox", e.target.checked))}
              />
              {t("wizard.exec.sandbox")}
            </label>
          )}
          {caps.autoRun && (
            <label className="choice">
              <input
                type="checkbox"
                checked={autoRun}
                onChange={(e) => void patch(setAutoRun(config.agent.options, e.target.checked, caps.toolConfirmation))}
              />
              {t("wizard.exec.autoRun")}
            </label>
          )}
          {caps.toolConfirmation === "permission-mode" && (
            <label>
              {t("wizard.exec.permissionMode")}
              <select value={mode} onChange={(e) => void patch(setPermissionMode(config.agent.options, e.target.value))}>
                <option value="bypassPermissions">{t("wizard.exec.permission.bypass")}</option>
                <option value="dontAsk">{t("wizard.exec.permission.dontAsk")}</option>
                <option value="acceptEdits">{t("wizard.exec.permission.acceptEdits")}</option>
              </select>
            </label>
          )}
          {caps.toolConfirmation === "auto-review-deny" && <p className="muted">{t("wizard.exec.danger")}</p>}
          {error && <p className="error-text">{error}</p>}
        </div>
      )}
    </div>
  );
}
