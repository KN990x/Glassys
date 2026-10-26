import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

/*
 * After an upgrade the service worker serves the new index while this page still asks for the
 * old lazy chunks (Settings, Wizard, host views), which are gone. Reload once to pick up the new
 * build; a second failure within a minute is a real outage and is left to the error boundary.
 */
const RELOADED_KEY = "glassys.preloadReload";
window.addEventListener("vite:preloadError", (event) => {
  try {
    const last = Number(sessionStorage.getItem(RELOADED_KEY) || 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem(RELOADED_KEY, String(Date.now()));
  } catch {
    /* private mode: reload anyway */
  }
  event.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}
