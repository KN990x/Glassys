import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { HostCapabilities, LogPage } from "@glassys/protocol";
import { I18nProvider } from "../../i18n";
import { LogsView, type HostSource } from "./HostViews";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const caps: HostCapabilities = { overview: true, services: null, logs: "journald", files: true };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function page(message: string): LogPage {
  return { entries: [{ ts: Date.now(), priority: 6, message }] };
}

describe("LogsView", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("drops a reply for a unit the operator already left", async () => {
    const pending = new Map<string, ReturnType<typeof deferred<LogPage>>>();
    const source = {
      hostLogs: (p: { unit?: string }) => {
        const d = deferred<LogPage>();
        pending.set(p.unit ?? "", d);
        return d.promise;
      },
    } as unknown as HostSource;
    host = document.createElement("div");
    document.body.append(host);
    const render = (unit: string) =>
      root.render(
        <I18nProvider locale="en">
          <LogsView source={source} caps={caps} locale="en" unit={unit} onUnit={() => undefined} onDraft={() => undefined} />
        </I18nProvider>,
      );
    await act(async () => {
      root = createRoot(host);
      render("a.service");
    });
    await act(async () => render("b.service"));
    await act(async () => pending.get("b.service")!.resolve(page("from b")));
    await act(async () => pending.get("a.service")!.resolve(page("from a")));
    expect(host.textContent).toContain("from b");
    expect(host.textContent).not.toContain("from a");
  });
});
