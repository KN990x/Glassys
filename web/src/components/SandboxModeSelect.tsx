import { useT } from "../i18n";

/**
 * An adapter's own sandbox levels (Codex: read-only, workspace-write, full access). The first
 * entry sets nothing and leaves the adapter's config in charge, so picking Glassys never
 * silently loosens or tightens what the operator configured there.
 */
export function SandboxModeSelect({
  id,
  modes,
  value,
  onChange,
}: {
  id?: string;
  modes: string[];
  value: string;
  onChange: (mode: string) => void;
}) {
  const t = useT();
  return (
    <select id={id} value={modes.includes(value) ? value : ""} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t("settings.sandboxMode.default")}</option>
      {modes.map((mode) => (
        <option key={mode} value={mode}>
          {t(`settings.sandboxMode.${mode}`)}
        </option>
      ))}
    </select>
  );
}
