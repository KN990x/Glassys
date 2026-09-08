import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { CatalogFallbackNotice } from "./CatalogFallback";
import { I18nProvider } from "../i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("CatalogFallbackNotice", () => {
  it("does not treat a static catalog as a live-catalog failure", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <I18nProvider locale="en">
          <CatalogFallbackNotice liveCatalog={false} source="fallback" error="Gemini CLI SDK is not available" />
        </I18nProvider>,
      );
    });
    expect(host.textContent).toBe("");
    act(() => root.unmount());
    host.remove();
  });

  it("puts the long catalog error in details, not in the warning line", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <I18nProvider locale="en">
          <CatalogFallbackNotice
            liveCatalog
            source="fallback"
            error="API key is required for cloud operations. Set CURSOR_API_KEY."
          />
        </I18nProvider>,
      );
    });
    expect(host.querySelector(".warn")?.textContent).toBe("Live catalog unavailable — showing adapter defaults. Sign in or check the API key.");
    expect(host.querySelector(".warn")?.textContent).not.toMatch(/CURSOR_API_KEY/);
    expect(host.querySelector("details")?.textContent).toMatch(/CURSOR_API_KEY/);
    act(() => root.unmount());
    host.remove();
  });
});
