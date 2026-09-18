/**
 * A boolean the operator can hit with a thumb. The native checkbox painted
 * itself with the browser's own accent, sat 16px tall next to 36px controls,
 * and gave no room for the label and description a host setting needs.
 */
export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
  id,
  hideLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
  id?: string;
  /** Inside a SettingRow the row already carries the label and the hint. */
  hideLabel?: boolean;
}) {
  return (
    <div className="switch-row">
      {hideLabel ? null : (
      <span className="switch-text">
        <span className="switch-label" id={id ? `${id}-label` : undefined}>
          {label}
        </span>
        {hint ? <span className="switch-hint">{hint}</span> : null}
      </span>
      )}
      <button
        type="button"
        role="switch"
        id={id}
        aria-checked={checked}
        aria-labelledby={id && !hideLabel ? `${id}-label` : undefined}
        aria-label={id && !hideLabel ? undefined : label}
        disabled={disabled}
        className="switch"
        onClick={() => onChange(!checked)}
      >
        <span className="switch-knob" aria-hidden="true" />
      </button>
    </div>
  );
}
