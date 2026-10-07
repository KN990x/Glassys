import { useCallback, useEffect, useRef, useState } from "react";

export type CopyState = "idle" | "copied" | "failed";

/**
 * Copy to the clipboard and say how it went for a moment. One implementation for every copy
 * button: the six it replaces each kept their own timer (never cleared on unmount) and two
 * dropped a refused write as an unhandled rejection.
 */
export function useCopy(resetMs = 1500): { state: CopyState; copy: (text: string) => Promise<boolean> } {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback(
    async (text: string) => {
      clearTimeout(timer.current);
      let ok = true;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        ok = false;
      }
      setState(ok ? "copied" : "failed");
      timer.current = setTimeout(() => setState("idle"), ok ? resetMs : resetMs + 300);
      return ok;
    },
    [resetMs],
  );
  return { state, copy };
}
