import type { ReactNode } from "react";
import type { HostCapabilities } from "@glassys/protocol";
import { useT } from "../i18n";
import type { HostViewId } from "../pages/host/HostViews";
import { IconFiles, IconGauge, IconLogs, IconServices, IconThreads } from "./Icon";

export type AppView = "chat" | HostViewId;

/**
 * The desktop topbar's views, the way CloudCLI puts Files and Git beside its
 * chat: the conversation, then the machine it is about. A view this host
 * cannot fill stays visible but dimmed, and explains itself when opened.
 */
export function ViewTabs({
  value,
  onChange,
  caps,
}: {
  value: AppView;
  onChange: (next: AppView) => void;
  caps: HostCapabilities | null;
}) {
  const t = useT();
  const items: Array<{ id: AppView; glyph: ReactNode; missing?: boolean }> = [
    { id: "chat", glyph: <IconThreads /> },
    { id: "overview", glyph: <IconGauge /> },
    { id: "services", glyph: <IconServices />, missing: caps !== null && !caps.services },
    { id: "logs", glyph: <IconLogs />, missing: caps !== null && !caps.logs },
    { id: "files", glyph: <IconFiles /> },
  ];
  return (
    <nav className="view-tabs" aria-label={t("nav.views")}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`view-tab${value === item.id ? " current" : ""}${item.missing ? " missing" : ""}`}
          aria-current={value === item.id ? "page" : undefined}
          title={t(`nav.${item.id}`)}
          onClick={() => onChange(item.id)}
        >
          {item.glyph}
          <span>{t(`nav.${item.id}`)}</span>
        </button>
      ))}
    </nav>
  );
}
