import { useEffect, useState } from "react";

/** Desktop rail vs mobile tab bar. Falls back to the narrow layout when unsupported. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    try {
      return typeof globalThis.matchMedia === "function" ? globalThis.matchMedia(query).matches : false;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (typeof globalThis.matchMedia !== "function") return;
    const mq = globalThis.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

export const DESKTOP_QUERY = "(min-width: 1024px)";
