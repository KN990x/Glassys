import type { ReactNode } from "react";
import { useT } from "../i18n";
import { IconCommand, IconSettings, IconThreads } from "./Icon";
import { GlassysMark } from "./Icon";

export type NavTarget = "chat" | "threads" | "ops" | "settings";

/** Mobile home row. Thumb-reachable, and it respects the home-indicator inset. */
export function BottomNav({
  active,
  onSelect,
}: {
  active: NavTarget;
  onSelect: (target: NavTarget) => void;
}) {
  const t = useT();
  const items: Array<{ id: NavTarget; label: string; glyph: ReactNode }> = [
    { id: "chat", label: t("nav.chat"), glyph: <GlassysMark size={20} /> },
    { id: "threads", label: t("nav.threads"), glyph: <IconThreads /> },
    { id: "ops", label: t("nav.ops"), glyph: <IconCommand /> },
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
          {item.glyph}
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
