import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, useState } from "react";
import { ArgsInput } from "./ArgsInput";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let saved: string[] = [];
let reset: (() => void) | null = null;

function Host() {
  const [args, setArgs] = useState<string[]>(["--acp"]);
  saved = args;
  reset = () => setArgs(["-x"]);
  return <ArgsInput value={args} onChange={setArgs} />;
}

describe("ArgsInput", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  async function type(input: HTMLInputElement, value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("keeps a typed space so a second argument can be typed, and follows outside changes", async () => {
    host = document.createElement("div");
    document.body.append(host);
    await act(async () => {
      root = createRoot(host);
      root.render(<Host />);
    });
    const input = host.querySelector("input")!;
    expect(input.value).toBe("--acp");
    await type(input, "--acp ");
    expect(input.value).toBe("--acp ");
    expect(saved).toEqual(["--acp"]);
    await type(input, "--acp -y");
    expect(saved).toEqual(["--acp", "-y"]);
    await act(async () => reset!());
    expect(input.value).toBe("-x");
  });
});
