/*
 * Keyboard and pointer conventions of the device the PWA runs on.
 */

/** macOS and iOS spell modifiers as glyphs; everyone else as words. */
export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/**
 * A shortcut written the platform's way: "mod+shift+o" is "⌘⇧O" on a Mac and "Ctrl+Shift+O"
 * elsewhere, where ⌘ means nothing.
 */
export function shortcutLabel(combo: string, apple = isApplePlatform()): string {
  const parts = combo.split("+").map((p) => p.trim().toLowerCase());
  const key = parts.pop() ?? "";
  const label = key === "esc" ? "Esc" : key.length === 1 ? key.toUpperCase() : key;
  if (apple) {
    const glyphs: Record<string, string> = { mod: "⌘", shift: "⇧", alt: "⌥", ctrl: "⌃" };
    return parts.map((p) => glyphs[p] ?? p).join("") + label;
  }
  const words: Record<string, string> = { mod: "Ctrl", shift: "Shift", alt: "Alt", ctrl: "Ctrl" };
  return [...parts.map((p) => words[p] ?? p), label].join("+");
}

/**
 * A phone or tablet without a pointing device: its on-screen Enter writes a newline, and the
 * Send button sends. A touch-screen laptop (or an iPad with a trackpad) still has a fine pointer
 * and a real keyboard, so Enter sends there.
 */
export function touchOnly(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(any-pointer: fine)").matches;
}

export function shouldSubmitOnEnter(e: { key: string; shiftKey: boolean; nativeEvent?: { isComposing?: boolean } }): boolean {
  if (e.key !== "Enter" || e.shiftKey) return false;
  if (e.nativeEvent?.isComposing) return false;
  return !touchOnly();
}
