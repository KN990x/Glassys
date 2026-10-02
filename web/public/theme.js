/* Applies the stored theme before first paint. A file, not an inline script, so the CSP can stay script-src 'self'. */
(function () {
  try {
    var stored = localStorage.getItem("glassys_theme");
    var theme = stored;
    if (theme !== "light" && theme !== "dark") {
      theme =
        window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark";
      if (stored !== "system") return;
    }
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#fafafa" : "#0a0a0a");
  } catch (e) {}
})();
