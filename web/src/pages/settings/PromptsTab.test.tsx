import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { PromptTemplate } from "@glassys/protocol";
import { I18nProvider } from "../../i18n";
import { PromptsTab } from "./PromptsTab";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("PromptsTab", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("adds a template over plain http, where crypto.randomUUID does not exist", () => {
    /* What a LAN install on http:// gets: getRandomValues only. */
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: <T extends ArrayBufferView>(a: T) => real.getRandomValues(a as never) });
    const added: PromptTemplate[][] = [];
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() =>
      root.render(
        <I18nProvider locale="en">
          <PromptsTab templates={[]} setTemplates={(next) => added.push(next)} />
        </I18nProvider>,
      ),
    );
    const add = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Add"));
    act(() => add?.click());
    expect(added.at(-1)?.[0]?.id).toMatch(/^tpl-[0-9a-f]{8}$/);
  });
});
