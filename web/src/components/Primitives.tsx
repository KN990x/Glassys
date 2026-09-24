import type { ReactNode } from "react";
import { IconAlert, IconCheck, IconChevronRight, IconError, IconInfo } from "./Icon";

/** A key on the operator's keyboard, drawn as one. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export type Tone = "neutral" | "ok" | "warn" | "danger" | "accent";

/**
 * A state, not an action: signed in, key configured, adapter unavailable.
 * Those used to be a stack of coloured <p> elements with no shared shape.
 */
export function StatusBadge({
  tone = "neutral",
  children,
  dot,
  glyph,
  mono,
}: {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
  glyph?: ReactNode;
  mono?: boolean;
}) {
  return (
    <span className={`badge tone-${tone}${mono ? " mono" : ""}`}>
      {dot ? <span className="badge-dot" aria-hidden="true" /> : glyph}
      {children}
    </span>
  );
}

/** Tone glyphs, shared with the alert stack so a warning looks the same twice. */
export function ToneGlyph({ tone }: { tone: Tone }) {
  if (tone === "danger") return <IconError />;
  if (tone === "warn") return <IconAlert />;
  if (tone === "ok") return <IconCheck />;
  return <IconInfo />;
}

/**
 * An inline message about the thing beside it. The archive warning, the
 * fallback-catalogue notice and the raw gateway errors were bare paragraphs in
 * warn orange, which read as louder than the settings they belonged to.
 */
export function Callout({
  tone = "neutral",
  children,
  action,
}: {
  tone?: Tone;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`callout tone-${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <span className="callout-icon">
        <ToneGlyph tone={tone} />
      </span>
      <span className="callout-text">{children}</span>
      {action}
    </div>
  );
}

/**
 * A summary row that opens its own body. Thinking blocks, tool groups and hunks
 * each had their own disclosure: one used a CSS background chevron that rotated,
 * the others swapped two lucide glyphs, so the same gesture looked different in
 * three places.
 */
export function Disclosure({
  open,
  onToggle,
  summary,
  children,
  meta,
  className,
}: {
  open: boolean;
  onToggle: () => void;
  summary: ReactNode;
  children: ReactNode;
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`disclosure${open ? " open" : ""}${className ? ` ${className}` : ""}`}>
      <div className="disclosure-head">
        <button type="button" className="disclosure-toggle" aria-expanded={open} onClick={onToggle}>
          <span className="disclosure-chevron" aria-hidden="true">
            <IconChevronRight />
          </span>
          {summary}
        </button>
        {meta}
      </div>
      {open && <div className="disclosure-body">{children}</div>}
    </div>
  );
}

/** A titled card of setting rows, divided by hairlines. */
export function SettingGroup({
  title,
  hint,
  children,
}: {
  /** Omitted when the tab's own heading already names the group. */
  title?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="setting-group">
      {title || hint ? (
        <div className="setting-group-head">
          {title ? <h4>{title}</h4> : null}
          {hint ? <p className="muted">{hint}</p> : null}
        </div>
      ) : null}
      <div className="setting-rows">{children}</div>
    </section>
  );
}

/**
 * Label and description on the left, the control on the right, at one row
 * height. Settings used to be a single 34rem column of stretched selects with
 * hints floating between them and checkboxes hanging off the left edge.
 */
export function SettingRow({
  label,
  hint,
  children,
  htmlFor,
  stack,
}: {
  label?: string;
  hint?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
  stack?: boolean;
}) {
  return (
    <div className={`setting-row${stack ? " stack-row" : ""}`}>
      {label ? (
        <span className="setting-text">
          {htmlFor ? (
            <label className="setting-label" htmlFor={htmlFor}>
              {label}
            </label>
          ) : (
            <span className="setting-label">{label}</span>
          )}
          {hint ? <span className="setting-hint">{hint}</span> : null}
        </span>
      ) : null}
      <div className="setting-control">{children}</div>
    </div>
  );
}

/** Placeholder rows while the transcript snapshot is still in flight. */
export function Skeleton({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <div className="skeleton" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="skeleton-line" />
      ))}
    </div>
  );
}

/**
 * One list row for every list: threads, activity, palette, services, files.
 * 32px, a 16px glyph, text that truncates, a tail pinned to the right edge and
 * hover actions that sit over the tail instead of reserving a column for
 * themselves — a reserved slot left every row 30px short on the right.
 */
export function ListRow({
  glyph,
  children,
  tail,
  actions,
  current,
  onClick,
  title,
  className,
  disabled,
  mono,
}: {
  glyph?: ReactNode;
  children: ReactNode;
  tail?: ReactNode;
  actions?: ReactNode;
  current?: boolean;
  onClick?: () => void;
  title?: string;
  className?: string;
  disabled?: boolean;
  mono?: boolean;
}) {
  const body = (
    <>
      {glyph ? (
        <span className="list-row-glyph" aria-hidden="true">
          {glyph}
        </span>
      ) : null}
      <span className={`list-row-text truncate${mono ? " mono" : ""}`}>{children}</span>
      {tail ? <span className="list-row-tail">{tail}</span> : null}
    </>
  );
  return (
    <div className={`list-row${current ? " current" : ""}${className ? ` ${className}` : ""}`}>
      {onClick ? (
        <button
          type="button"
          className="list-row-main"
          onClick={onClick}
          title={title}
          disabled={disabled}
          aria-current={current ? "true" : undefined}
        >
          {body}
        </button>
      ) : (
        <span className="list-row-main" title={title}>
          {body}
        </span>
      )}
      {actions ? <span className="list-row-actions">{actions}</span> : null}
    </div>
  );
}

/** Share of a whole as a thin bar: amber from 70%, red from 90%. */
export function meterTone(ratio: number): Tone {
  if (ratio >= 0.9) return "danger";
  if (ratio >= 0.7) return "warn";
  return "ok";
}

export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <span
      className={`meter tone-${meterTone(ratio)}`}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      <span className="meter-fill" style={{ width: `${(ratio * 100).toFixed(1)}%` }} />
    </span>
  );
}
