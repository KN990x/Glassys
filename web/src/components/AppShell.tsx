import type { ReactNode } from "react";
import { useT } from "../i18n";

/**
 * The frame every screen after sign-in sits in: an optional rail, the centre
 * column (topbar, then the chat or a host view), an optional inspector — a
 * column from 1280px, a sheet over the page below that — the phone's tab bar,
 * and whatever overlays are open. It owns the grid and nothing else; what goes
 * in each slot is the caller's.
 */
export function AppShell({
  rail,
  railMode,
  topbar,
  children,
  inspector,
  inspectorAsColumn,
  onCloseInspector,
  bottomNav,
  overlays,
}: {
  rail?: ReactNode;
  railMode: "full" | "mini" | "none";
  topbar: ReactNode;
  children: ReactNode;
  inspector?: ReactNode;
  inspectorAsColumn: boolean;
  onCloseInspector: () => void;
  bottomNav?: ReactNode;
  overlays?: ReactNode;
}) {
  const t = useT();
  const classes = [
    "app-shell",
    railMode === "full" ? "has-rail" : railMode === "mini" ? "has-mini-rail" : "",
    inspector && inspectorAsColumn ? "has-inspector" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      {rail}
      <div className="chat-shell">
        {topbar}
        {children}
      </div>
      {bottomNav}
      {inspector ? (
        inspectorAsColumn ? (
          inspector
        ) : (
          <div className="inspector-sheet" role="dialog" aria-modal="true" aria-label={t("nav.activity")}>
            <div className="thread-scrim" onClick={onCloseInspector} aria-hidden="true" />
            {inspector}
          </div>
        )
      ) : null}
      {overlays}
    </div>
  );
}
