import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { I18nProvider } from "../i18n";
import { ReachabilityCard } from "./Reachability";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../api", () => ({
  api: {
    reachability: vi.fn(async () => ({
      bind: "127.0.0.1",
      port: 8787,
      publicUrl: "https://glassys.example",
      loopback: true,
    })),
  },
}));

describe("ReachabilityCard", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("prefers publicUrl from the gateway over the page origin", async () => {
    host = document.createElement("div");
    document.body.append(host);
    await act(async () => {
      root = createRoot(host);
      root.render(
        <I18nProvider locale="en">
          <ReachabilityCard />
        </I18nProvider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("code")?.textContent).toBe("https://glassys.example");
  });
});
