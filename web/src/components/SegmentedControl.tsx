import type { ReactNode } from "react";

export type Segment<T extends string> = {
  value: T;
  label: string;
  glyph?: ReactNode;
  title?: string;
};

/**
 * Two to four mutually exclusive choices, all visible. It replaces the
 * <select> in places where the options are short and the operator switches
 * between them often — effort, recurring or once, commands or files.
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  size,
}: {
  value: T;
  options: Segment<T>[];
  onChange: (next: T) => void;
  label: string;
  size?: "sm";
}) {
  return (
    <div className={`segmented${size === "sm" ? " sm" : ""}`} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          title={option.title}
          className={`segment${option.value === value ? " current" : ""}`}
          onClick={() => onChange(option.value)}
        >
          {option.glyph}
          <span className="truncate">{option.label}</span>
        </button>
      ))}
    </div>
  );
}
