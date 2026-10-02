import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute("disabled"));
}

/**
 * Modal sheet focus: move focus in, keep Tab inside, close on Escape, and hand
 * focus back to whatever had it on close. Escape is taken in the capture phase
 * so the chat's own Escape (cancel the run) never sees it while a sheet is open.
 * Keys from outside the sheet (a palette stacked over it) are left alone.
 */
export function useDialogFocus(
  rootRef: RefObject<HTMLElement | null>,
  onEscape: () => void,
  initialRef?: RefObject<HTMLElement | null>,
): void {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (initialRef?.current ?? focusableIn(root)[0] ?? root).focus();

    function onKey(e: KeyboardEvent) {
      const active = document.activeElement;
      if (!root || (active && active !== document.body && !root.contains(active))) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const nodes = focusableIn(root);
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && (active === last || !root.contains(active))) {
        e.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      const now = document.activeElement;
      if (previous?.isConnected && (!now || now === document.body || !now.isConnected || root.contains(now))) {
        previous.focus();
      }
    };
  }, []);
}
