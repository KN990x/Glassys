import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { I18nProvider } from "../i18n";
import { ConfirmDialog, useConfirm } from "./ConfirmDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function mount(node: React.ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<I18nProvider locale="en">{node}</I18nProvider>));
}

describe("ConfirmDialog", () => {
  it("starts a destructive ask on Cancel and names its message", () => {
    mount(<ConfirmDialog request={{ message: "Delete the thread?", destructive: true }} onResolve={() => undefined} />);
    expect(document.activeElement?.textContent).toBe("Cancel");
    const panel = host.querySelector('[role="alertdialog"]')!;
    expect(document.getElementById(panel.getAttribute("aria-describedby")!)?.textContent).toBe("Delete the thread?");
  });

  it("starts a harmless ask on its confirm button", () => {
    mount(<ConfirmDialog request={{ message: "Archive?", kind: "archive" }} onResolve={() => undefined} />);
    expect(document.activeElement?.className).toBe("primary");
  });

  it("answers no to an ask that a second one replaced", async () => {
    let ask!: ReturnType<typeof useConfirm>["confirm"];
    function Harness() {
      const { confirm, confirmDialog } = useConfirm();
      ask = confirm;
      return <>{confirmDialog}</>;
    }
    mount(<Harness />);
    let first!: Promise<boolean>;
    act(() => {
      first = ask({ message: "one" });
    });
    act(() => {
      void ask({ message: "two" });
    });
    await expect(first).resolves.toBe(false);
  });
});
