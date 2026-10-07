import { describe, expect, it, vi } from "vitest";
import { handleChatKey, type ChatShortcutContext } from "./chatShortcuts";

function ctx(over: Partial<ChatShortcutContext> = {}): ChatShortcutContext {
  return {
    activityOpen: false,
    railCollapsed: false,
    paletteOpen: false,
    slashOpen: false,
    searchOpen: false,
    busy: true,
    view: "chat",
    overlayOpen: false,
    canCancel: true,
    composer: null,
    toggleActivity: vi.fn(),
    collapseRail: vi.fn(),
    openSearch: vi.fn(),
    closeSearch: vi.fn(),
    newThread: vi.fn(),
    togglePalette: vi.fn(),
    closePalettes: vi.fn(),
    cancelRun: vi.fn(),
    ...over,
  };
}

const key = (k: string, init: KeyboardEventInit = {}) => new KeyboardEvent("keydown", { key: k, cancelable: true, ...init });

describe("handleChatKey", () => {
  it("maps the modifier shortcuts with Ctrl as well as ⌘", () => {
    const c = ctx();
    handleChatKey(key("k", { ctrlKey: true }), c);
    handleChatKey(key("O", { metaKey: true, shiftKey: true }), c);
    handleChatKey(key("i", { ctrlKey: true }), c);
    expect(c.togglePalette).toHaveBeenCalled();
    expect(c.newThread).toHaveBeenCalled();
    expect(c.toggleActivity).toHaveBeenCalledWith(true);
  });

  it("uses Escape to close what is open before it cancels a run", () => {
    const c = ctx({ paletteOpen: true });
    handleChatKey(key("Escape"), c);
    expect(c.closePalettes).toHaveBeenCalled();
    expect(c.cancelRun).not.toHaveBeenCalled();
    const d = ctx();
    handleChatKey(key("Escape"), d);
    expect(d.cancelRun).toHaveBeenCalled();
  });

  it("does not cancel from another view, an overlay or another field", () => {
    for (const over of [{ view: "logs" }, { overlayOpen: true }, { canCancel: false }, { busy: false }]) {
      const c = ctx(over);
      handleChatKey(key("Escape"), c);
      expect(c.cancelRun).not.toHaveBeenCalled();
    }
    const field = document.createElement("input");
    const c = ctx();
    field.addEventListener("keydown", (e) => handleChatKey(e, c));
    field.dispatchEvent(key("Escape"));
    expect(c.cancelRun).not.toHaveBeenCalled();
  });
});
