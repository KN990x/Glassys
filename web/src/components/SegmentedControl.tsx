import { useRef, type KeyboardEvent, type ReactNode } from "react";

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
  const group = useRef<HTMLDivElement>(null);
  /* A radio group is one tab stop; arrows move the choice, as native radios do. */
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    const edge = e.key === "Home" ? 0 : e.key === "End" ? options.length - 1 : -1;
    if (!step && edge < 0) return;
    e.preventDefault();
    const current = Math.max(0, options.findIndex((o) => o.value === value));
    const next = edge >= 0 ? edge : (current + step + options.length) % options.length;
    onChange(options[next]!.value);
    group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  }
  const anyChecked = options.some((o) => o.value === value);
  return (
    <div
      ref={group}
      className={`segmented${size === "sm" ? " sm" : ""}`}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {options.map((option, i) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked || (!anyChecked && i === 0) ? 0 : -1}
            title={option.title}
            className={`segment${checked ? " current" : ""}`}
            onClick={() => onChange(option.value)}
          >
            {option.glyph}
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
