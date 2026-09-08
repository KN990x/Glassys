import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../i18n";
import type { PromptTemplate } from "@glassys/protocol";

export type PaletteItem = {
  id: string;
  group: "product" | "template";
  label: string;
  hint?: string;
  run: () => void;
};

export function filterPaletteItems(items: PaletteItem[], query: string): PaletteItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => `${item.label} ${item.hint || ""} ${item.id}`.toLowerCase().includes(q));
}

export function CommandPalette({
  open,
  query,
  items,
  onClose,
  onQuery,
  inline,
  hideSearch,
}: {
  open: boolean;
  query: string;
  items: PaletteItem[];
  onClose: () => void;
  onQuery?: (q: string) => void;
  inline?: boolean;
  hideSearch?: boolean;
}) {
  const t = useT();
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => filterPaletteItems(items, query), [items, query]);

  useEffect(() => {
    setActive(0);
  }, [query, open, items]);

  useEffect(() => {
    if (open && !hideSearch) inputRef.current?.focus();
  }, [open, hideSearch]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((n) => Math.min(filtered.length - 1, n + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((n) => Math.max(0, n - 1));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const item = filtered[active];
        if (!item) return;
        item.run();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, filtered, active, onClose]);

  if (!open) return null;

  function choose(i: number) {
    const item = filtered[i];
    if (!item) return;
    item.run();
    onClose();
  }

  const panel = (
    <div className={`palette-panel${inline ? " palette-inline" : ""}`} role={inline ? "listbox" : undefined}>
      {!hideSearch && (
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onQuery?.(e.target.value)}
          placeholder={t("palette.placeholder")}
          aria-label={t("palette.placeholder")}
        />
      )}
      <ul className="palette-list">
        {filtered.map((item, i) => (
          <li key={item.id}>
            <button
              type="button"
              className={`ghost picker-item${i === active ? " current" : ""}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(i)}
            >
              <strong>{item.label}</strong>
              {item.hint ? <span className="muted">{item.hint}</span> : null}
            </button>
          </li>
        ))}
        {filtered.length === 0 && <li className="muted">{t("palette.empty")}</li>}
      </ul>
    </div>
  );

  if (inline) return panel;

  return (
    <div className="palette-overlay" role="dialog" aria-modal="true" aria-label={t("palette.title")}>
      <button type="button" className="thread-scrim" aria-label={t("threads.close")} onClick={onClose} />
      {panel}
    </div>
  );
}

export function templatePaletteItems(
  templates: PromptTemplate[],
  t: (key: string) => string,
  insert: (text: string) => void,
): PaletteItem[] {
  return templates.map((tpl) => ({
    id: `tpl:${tpl.id}`,
    group: "template" as const,
    label: t(`prompt.${tpl.id}`) === `prompt.${tpl.id}` ? tpl.title : t(`prompt.${tpl.id}`),
    hint: `/${tpl.slash}`,
    run: () => insert(tpl.text),
  }));
}
