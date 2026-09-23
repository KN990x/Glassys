import { useMemo, useState } from "react";
import { useT } from "../i18n";
import { Disclosure } from "./Primitives";
import { IconBrain } from "./Icon";

export function formatThinkingDuration(
  durationMs?: number,
  labels: { pending: string; unit: string } = { pending: "…", unit: "s" },
): string {
  if (durationMs === undefined || durationMs <= 0) return labels.pending;
  return `${Math.max(1, Math.round(durationMs / 1000))}${labels.unit}`;
}

/**
 * Reasoning is context, not content: it now reads as a quiet line with the
 * shared disclosure, rather than a bordered card heavier than the tool rows
 * underneath it.
 */
export function Thinking({ text, durationMs, defaultOpen }: { text: string; durationMs?: number; defaultOpen: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);
  const seconds = useMemo(
    () => formatThinkingDuration(durationMs, { pending: t("thinking.pending"), unit: t("thinking.seconds") }),
    [durationMs, t],
  );

  return (
    <Disclosure
      className="thinking"
      open={open}
      onToggle={() => setOpen((v) => !v)}
      summary={
        <>
          <IconBrain />
          <span>
            {t("thinking.label")} · <span className="nums">{seconds}</span>
          </span>
        </>
      }
    >
      <div className="thinking-body">{text}</div>
    </Disclosure>
  );
}
