import { useEffect, useRef, type ReactNode } from "react";

export type PopoverSide = "top" | "bottom";
export type PopoverAlign = "start" | "end";

/**
 * One floating surface for every menu in the product. The permission chip, the
 * model menu, the topbar overflow and the inline prompt list each used to
 * position, dismiss and paint themselves; three of the four could not be
 * closed with Escape, and two could overflow a phone's viewport.
 *
 * The caller owns `open` and renders this inside a `.pop-anchor`.
 */
export function Popover({
  open,
  onClose,
  children,
  label,
  side = "top",
  align = "start",
  id,
  wide,
  className,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  label: string;
  side?: PopoverSide;
  align?: PopoverAlign;
  id?: string;
  wide?: boolean;
  /** `pop-menu` for a list of commands: tighter rows, no section padding. */
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const root = panel.current?.closest(".pop-anchor");
      if (root && !root.contains(e.target as Node)) onCloseRef.current();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      /* A dialog opened from this menu (a confirm) sits on top: its Escape is its own. Both
         listen on window, so stopping propagation could not keep this one out of it. */
      const own = panel.current;
      const modals = [...document.querySelectorAll('[aria-modal="true"]')];
      if (own && modals.some((m) => !m.contains(own))) return;
      e.stopPropagation();
      onCloseRef.current();
    }
    /* Focus moves into the menu, and back to what opened it when it closes. */
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = panel.current?.querySelector<HTMLElement>('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    first?.focus();
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey, true);
      const now = document.activeElement;
      if (opener?.isConnected && (!now || now === document.body || panel.current === null || panel.current.contains(now))) {
        opener.focus();
      }
    };
  }, [open]);

  if (!open) return null;
  return (
    <div
      ref={panel}
      id={id}
      className={`pop pop-${side} pop-${align}${wide ? " pop-wide" : ""}${className ? ` ${className}` : ""}`}
      role="dialog"
      aria-label={label}
    >
      {children}
    </div>
  );
}

/** The anchor a popover measures itself against. */
export function PopAnchor({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`pop-anchor${className ? ` ${className}` : ""}`}>{children}</div>;
}
