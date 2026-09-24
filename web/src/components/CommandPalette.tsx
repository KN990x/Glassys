import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useT } from "../i18n";
import type { PromptTemplate } from "@glassys/protocol";
import { Kbd } from "./Primitives";
import { IconSearch, IconZap } from "./Icon";

export type PaletteGroup = "product" | "thread" | "workspace" | "template";

export type PaletteItem = {
  id: string;
  group: PaletteGroup;
  label: string;
  hint?: string;
  glyph?: ReactNode;
  kbd?: string;
  run: () => void;
};

export function filterPaletteItems(items: PaletteItem[], query: string): PaletteItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => `${item.label} ${item.hint || ""} ${item.id}`.toLowerCase().includes(q));
}

export function paletteItemIds(items: PaletteItem[]): string {
  return items.map((item) => item.id).join("\n");
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
  const ids = paletteItemIds(filtered);

  useEffect(() => {
    setActive(0);
  }, [query, open, ids]);

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
        <span className="search-field palette-search">
          <IconSearch />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => onQuery?.(e.target.value)}
            placeholder={t("palette.placeholder")}
            aria-label={t("palette.placeholder")}
          />
        </span>
      )}
      <ul className="palette-list">
        {filtered.map((item, i) => {
          const header = i === 0 || item.group !== filtered[i - 1]?.group;
          return (
            <Fragment key={item.id}>
              {header && (
                <li className="muted palette-group" aria-hidden="true">
                  {t(`palette.group.${item.group}`)}
                </li>
              )}
              <li>
                <button
                  type="button"
                  className={`ghost picker-item${i === active ? " current" : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(i)}
                >
                  <span className="palette-glyph" aria-hidden="true">
                    {item.glyph ?? <IconZap />}
                  </span>
                  {/* One line: the label, then the hint in mono on the right. A second
                      line under every row made the list twice as tall to scan. */}
                  <strong className="palette-label truncate">{item.label}</strong>
                  {item.hint ? <span className="palette-hint truncate">{item.hint}</span> : null}
                  {item.kbd ? <Kbd>{item.kbd}</Kbd> : null}
                </button>
              </li>
            </Fragment>
          );
        })}
        {filtered.length === 0 && <li className="muted palette-empty">{t("palette.empty")}</li>}
      </ul>
      {!inline && (
        <footer className="palette-foot muted">
          <span>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> {t("palette.move")}
          </span>
          <span>
            <Kbd>⏎</Kbd> {t("palette.run")}
          </span>
          <span>
            <Kbd>esc</Kbd> {t("palette.close")}
          </span>
        </footer>
      )}
    </div>
  );

  if (inline) return panel;

  return (
    <div className="palette-overlay" role="dialog" aria-modal="true" aria-label={t("palette.title")}>
      {/* A div, not a button: a full-viewport focusable scrim painted a
          viewport-wide focus ring. Escape and the list already close it. */}
      <div className="thread-scrim" onClick={onClose} aria-hidden="true" />
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
