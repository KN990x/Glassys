import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { I18nProvider } from "../i18n";
import type { Block } from "../transcript";
import { Transcript, type TranscriptProps } from "./Transcript";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function props(blocks: Block[], busy: boolean): TranscriptProps {
  return {
    blocks,
    allBlocks: blocks,
    snapshotReady: true,
    connecting: false,
    search: "",
    queuedIds: new Set(),
    locale: "en",
    thinkingDefault: "collapsed",
    shellLines: 8,
    showDiff: true,
    opsChips: [],
    onTemplate: () => undefined,
    hostLabel: "",
    cwd: "/",
    adapterName: "cursor",
    queue: [],
    busy,
  };
}

describe("Transcript announcements", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("announces a reply once it stops streaming, not while it streams", async () => {
    host = document.createElement("div");
    document.body.append(host);
    const render = (text: string, busy: boolean) =>
      root.render(
        <I18nProvider locale="en">
          <Transcript {...props([{ id: "tx1", kind: "text", text }], busy)} />
        </I18nProvider>,
      );
    await act(async () => {
      root = createRoot(host);
      render("Disk is", true);
    });
    const status = () => host.querySelector('p[role="status"]')?.textContent ?? "";
    expect(status()).toBe("");
    await act(async () => render("Disk is 40% full.", true));
    expect(status()).toBe("");
    await act(async () => render("Disk is 40% full.", false));
    expect(status()).toBe("Disk is 40% full.");
  });
});
