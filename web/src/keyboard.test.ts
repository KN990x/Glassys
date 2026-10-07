import { afterEach, describe, expect, it, vi } from "vitest";
import { shortcutLabel, shouldSubmitOnEnter } from "./keyboard";

describe("shouldSubmitOnEnter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const pointer = (coarseOnly: boolean) =>
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q === "(pointer: coarse)" ? coarseOnly : q === "(any-pointer: fine)" ? !coarseOnly : false,
    }));

  it("submits on Enter on a desktop keyboard, touch screen or not", () => {
    pointer(false);
    expect(shouldSubmitOnEnter({ key: "Enter", shiftKey: false })).toBe(true);
    expect(shouldSubmitOnEnter({ key: "Enter", shiftKey: true })).toBe(false);
    expect(shouldSubmitOnEnter({ key: "Enter", shiftKey: false, nativeEvent: { isComposing: true } })).toBe(false);
  });

  it("does not submit on Enter on a phone, where Enter is the soft keyboard's newline", () => {
    pointer(true);
    expect(shouldSubmitOnEnter({ key: "Enter", shiftKey: false })).toBe(false);
  });
});

describe("shortcutLabel", () => {
  it("writes modifiers as glyphs on Apple platforms and as words elsewhere", () => {
    expect(shortcutLabel("mod+shift+o", true)).toBe("⌘⇧O");
    expect(shortcutLabel("mod+shift+o", false)).toBe("Ctrl+Shift+O");
    expect(shortcutLabel("mod+k", false)).toBe("Ctrl+K");
    expect(shortcutLabel("esc", true)).toBe("Esc");
  });
});
