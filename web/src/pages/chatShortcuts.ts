/** What the chat's global shortcuts read and do, at the moment of the key press. */
export type ChatShortcutContext = {
  activityOpen: boolean;
  railCollapsed: boolean;
  paletteOpen: boolean;
  slashOpen: boolean;
  searchOpen: boolean;
  busy: boolean;
  /** The view on screen; Escape only cancels from the chat. */
  view: string;
  /** Settings or the thread sheet is open: Escape belongs to them. */
  overlayOpen: boolean;
  canCancel: boolean;
  composer: HTMLElement | null;
  toggleActivity: (open: boolean) => void;
  collapseRail: (collapsed: boolean) => void;
  openSearch: () => void;
  closeSearch: () => void;
  newThread: () => void;
  togglePalette: () => void;
  closePalettes: () => void;
  cancelRun: () => void;
};

/** True for a field other than the composer: Escape there means "leave this field". */
function inOtherField(target: EventTarget | null, composer: HTMLElement | null): boolean {
  return (
    target instanceof HTMLElement &&
    target !== composer &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/** The chat's global shortcuts: ⌘/Ctrl + I, B, F, ⇧O, K, and Escape. */
export function handleChatKey(e: KeyboardEvent, c: ChatShortcutContext): void {
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();
  if (mod && key === "i") {
    e.preventDefault();
    c.toggleActivity(!c.activityOpen);
    return;
  }
  if (mod && key === "b") {
    e.preventDefault();
    c.collapseRail(!c.railCollapsed);
    return;
  }
  if (mod && key === "f") {
    e.preventDefault();
    c.openSearch();
    return;
  }
  if (mod && e.shiftKey && key === "o") {
    e.preventDefault();
    c.newThread();
    return;
  }
  if (mod && key === "k") {
    e.preventDefault();
    c.togglePalette();
    return;
  }
  if (e.key !== "Escape") return;
  if (c.paletteOpen || c.slashOpen) {
    c.closePalettes();
    return;
  }
  if (c.searchOpen) {
    c.closeSearch();
    return;
  }
  /* Escape is the shortcut the run strip advertises, in the chat only. */
  if (c.busy && c.view === "chat" && !c.overlayOpen && c.canCancel && !inOtherField(e.target, c.composer)) {
    c.cancelRun();
  }
}
