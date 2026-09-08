import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { I18nProvider } from "./i18n";
import { MarkdownBody, safeHref } from "./components/MarkdownBody";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("safeHref", () => {
  it("allows http, https, mailto, and hash", () => {
    expect(safeHref("https://example.com")).toBe("https://example.com");
    expect(safeHref("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
    expect(safeHref("mailto:op@example.com")).toBe("mailto:op@example.com");
    expect(safeHref("#section")).toBe("#section");
  });

  it("rejects javascript and other schemes", () => {
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref("data:text/html,x")).toBeUndefined();
  });
});

describe("MarkdownBody", () => {
  it("does not render javascript links or remote images", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    await act(async () => {
      createRoot(host).render(
        <I18nProvider locale="en">
          <MarkdownBody text={"[x](javascript:alert(1))\n\n![img](https://evil.example/x.png)"} />
        </I18nProvider>,
      );
    });
    expect(host.querySelector("a")).toBeNull();
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toContain("x");
    host.remove();
  });
});
