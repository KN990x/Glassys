import { useT } from "../i18n";
import { SegmentedControl } from "./SegmentedControl";

const MODES = ["bypassPermissions", "acceptEdits", "dontAsk"] as const;
type Mode = (typeof MODES)[number];

const LABELS: Record<Mode, string> = {
  bypassPermissions: "wizard.exec.permission.bypass",
  acceptEdits: "wizard.exec.permission.acceptEdits",
  dontAsk: "wizard.exec.permission.dontAsk",
};

/**
 * Claude's permission mode, the same control in the wizard, Settings and the permission chip. A
 * stored mode outside the three (plan, default) shows as the nearest: bypass.
 */
export function PermissionModeControl({
  value,
  onChange,
  commit,
}: {
  value: string;
  onChange: (mode: string) => void;
  commit?: "move" | "confirm";
}) {
  const t = useT();
  const current: Mode = (MODES as readonly string[]).includes(value) ? (value as Mode) : "bypassPermissions";
  return (
    <SegmentedControl
      size="sm"
      commit={commit}
      label={t("wizard.exec.permissionMode")}
      value={current}
      onChange={onChange}
      options={MODES.map((mode) => ({ value: mode, label: t(LABELS[mode]) }))}
    />
  );
}
