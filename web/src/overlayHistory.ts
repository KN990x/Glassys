/**
 * Mobile overlays (thread sheet, Settings) own one history entry so the system
 * back gesture closes them instead of leaving the app.
 */
export type OverlayKind = "threads" | "settings";

/* history.back() is async: until popstate lands, history.state still reads as
   the overlay, and a second close would walk out of the app. */
let popPending = false;

function overlayState(): { glassysOverlay?: string } | null {
  const st = history.state;
  if (st && typeof st === "object" && "glassysOverlay" in st) return st as { glassysOverlay?: string };
  return null;
}

export function pushOverlay(kind: OverlayKind): void {
  if (overlayState()) history.replaceState({ glassysOverlay: kind }, "");
  else history.pushState({ glassysOverlay: kind }, "");
}

export function popOverlay(): void {
  if (popPending || !overlayState()) return;
  popPending = true;
  history.back();
}

export function overlayPopped(): void {
  popPending = false;
}
