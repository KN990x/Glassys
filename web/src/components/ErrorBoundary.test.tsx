import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { I18nProvider } from "../i18n";
import { CrashedRow, CrashScreen, ErrorBoundary } from "./ErrorBoundary";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Boom(): never {
  throw new Error("render failed");
}

describe("ErrorBoundary", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  function render(node: React.ReactNode) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root.render(<I18nProvider locale="en">{node}</I18nProvider>));
  }

  it("keeps the other rows when one fails", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <>
        <ErrorBoundary label="row" fallback={() => <CrashedRow />}>
          <Boom />
        </ErrorBoundary>
        <p className="next">still here</p>
      </>,
    );
    expect(host.textContent).toContain("could not be shown");
    expect(host.querySelector(".next")?.textContent).toBe("still here");
  });

  it("offers a reload when the whole screen fails", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <ErrorBoundary label="app" fallback={() => <CrashScreen />}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(host.querySelector("h2")?.textContent).toBe("Something went wrong");
    expect(host.querySelector("button.primary")?.textContent).toBe("Reload");
  });
});
