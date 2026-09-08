import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { I18nProvider } from "../i18n";
import { ToolCard } from "./ToolCard";
import type { ToolBlock } from "../transcript";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function shellBlock(over: Partial<ToolBlock> = {}): ToolBlock {
  return {
    id: "t1",
    kind: "tool",
    callId: "c1",
    toolKind: "shell",
    title: "bash",
    command: "journalctl -u caddy",
    status: "done",
    chunk: Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n"),
    ...over,
  };
}

describe("ToolCard", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("copies the shell command and expands truncated output", async () => {
    host = document.createElement("div");
    document.body.append(host);
    await act(async () => {
      root = createRoot(host);
      root.render(
        <I18nProvider locale="en">
          <ToolCard block={shellBlock()} shellLines={4} showDiff={false} />
        </I18nProvider>,
      );
    });
    expect(host.textContent).toContain("Copy command");
    await act(async () => {
      host.querySelector(".tool-head")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.textContent).toContain("Show more");
    expect(host.querySelector(".shell-out")?.textContent).not.toContain("line 0");
    await act(async () => {
      [...host.querySelectorAll("button")].find((b) => b.textContent === "Show more")?.click();
    });
    expect(host.querySelector(".shell-out")?.textContent).toContain("line 0");
    expect(host.textContent).toContain("Show less");
  });
});
