import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./api", () => ({
  api: {
    status: vi.fn(() => Promise.reject(new Error("down"))),
    me: vi.fn(),
    config: vi.fn(),
    logout: vi.fn(),
  },
  getToken: () => null,
}));

describe("App boot", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("shows retry when the gateway is unreachable", async () => {
    host = document.createElement("div");
    document.body.append(host);
    const { App } = await import("./App");
    await act(async () => {
      root = createRoot(host);
      root.render(<App />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toMatch(/gateway/i);
    expect(host.querySelector("button")?.textContent).toMatch(/retry|reintentar/i);
  });
});
