import { useMemo, useState } from "react";
import { useT } from "../i18n";

export function formatThinkingDuration(
  durationMs?: number,
  labels: { pending: string; unit: string } = { pending: "…", unit: "s" },
): string {
  if (durationMs === undefined || durationMs <= 0) return labels.pending;
  return `${Math.max(1, Math.round(durationMs / 1000))}${labels.unit}`;
}

export function Thinking({ text, durationMs, defaultOpen }: { text: string; durationMs?: number; defaultOpen: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);
  const seconds = useMemo(
    () => formatThinkingDuration(durationMs, { pending: t("thinking.pending"), unit: t("thinking.seconds") }),
    [durationMs, t],
  );

  return (
    <details className="thinking" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        {t("thinking.label")} · {seconds}
      </summary>
      <div className="thinking-body">{text}</div>
    </details>
  );
}
