import type { ReactNode } from "react";
import { useT } from "../i18n";
import { IconFiles, IconHistory, IconOverview, IconSettings, IconThreads } from "./Icon";

export type NavTarget = "chat" | "threads" | "host" | "files" | "settings";

/**
 * Mobile home row. Thumb-reachable, and it respects the home-indicator inset.
 * Activity left it for a button in the chat's topbar: it belongs to a thread,
 * while Host and Files belong to the machine.
 */
export function BottomNav({
  active,
  onSelect,
}: {
  active: NavTarget;
  onSelect: (target: NavTarget) => void;
}) {
  const t = useT();
  const items: Array<{ id: NavTarget; label: string; glyph: ReactNode }> = [
    { id: "chat", label: t("nav.chat"), glyph: <IconThreads /> },
    { id: "threads", label: t("nav.threads"), glyph: <IconHistory /> },
    { id: "host", label: t("nav.host"), glyph: <IconOverview /> },
    { id: "files", label: t("nav.files"), glyph: <IconFiles /> },
    { id: "settings", label: t("nav.settings"), glyph: <IconSettings /> },
  ];
  return (
    <nav className="tabbar" aria-label={t("nav.primary")}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`tabbar-item${active === item.id ? " current" : ""}`}
          aria-current={active === item.id ? "page" : undefined}
          onClick={() => onSelect(item.id)}
        >
          <span className="tabbar-glyph">{item.glyph}</span>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
