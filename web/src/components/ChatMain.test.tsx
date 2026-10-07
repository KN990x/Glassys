import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createRef } from "react";
import { I18nProvider } from "../i18n";
import { ChatMain } from "./ChatMain";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ChatMain", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("reports a size change of the scroller and of its content", async () => {
    const callbacks: Array<() => void> = [];
    const observed: Element[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          callbacks.push(cb);
        }
        observe(el: Element) {
          observed.push(el);
        }
        disconnect() {}
      },
    );
    const onResize = vi.fn();
    const scrollerRef = createRef<HTMLDivElement>();
    host = document.createElement("div");
    document.body.append(host);
    await act(async () => {
      root = createRoot(host);
      root.render(
        <I18nProvider locale="en">
          <ChatMain
            alerts={[]}
            notices={[]}
            scrollerRef={scrollerRef}
            onScroll={() => undefined}
            onResize={onResize}
            atBottom
            onJumpBottom={() => undefined}
            transcript={{
              blocks: [],
              allBlocks: [],
              snapshotReady: true,
              connecting: false,
              search: "",
              queuedIds: new Set(),
              locale: "en",
              thinkingDefault: "collapsed",
              shellLines: 12,
              showDiff: true,
              opsChips: [],
              onTemplate: () => undefined,
              hostLabel: "host",
              cwd: "/w",
              adapterName: "ACP",
              queue: [],
            }}
          />
        </I18nProvider>,
      );
    });
    expect(observed).toEqual([scrollerRef.current, scrollerRef.current?.firstElementChild]);
    act(() => callbacks[0]?.());
    expect(onResize).toHaveBeenCalledTimes(1);
  });
});
