import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ServerMessage } from "@glassys/protocol";
import type { Block } from "./transcript";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const socket = vi.hoisted(() => {
  let onEvent: ((msg: ServerMessage) => void) | undefined;
  return {
    emit: (msg: ServerMessage) => onEvent?.(msg),
    bind: (fn: (msg: ServerMessage) => void) => {
      onEvent = fn;
    },
  };
});

vi.mock("./socket", () => ({
  openSocket: (handlers: { onEvent: (msg: ServerMessage) => void }) => {
    socket.bind(handlers.onEvent);
    return { send: () => true, close: () => undefined, setKeepalive: () => undefined };
  },
}));
vi.mock("./api", () => ({ api: { logout: vi.fn(async () => undefined) } }));

describe("useGatewaySession", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  async function mount(opts: { onRefusal?: (m: string) => void; onNotice?: (m: string) => void } = {}) {
    const { useGatewaySession } = await import("./useGatewaySession");
    const seen: { blocks: Block[] } = { blocks: [] };
    function Probe() {
      const session = useGatewaySession({
        keepaliveSeconds: 25,
        onConfig: () => undefined,
        onLogout: () => undefined,
        onRefusal: opts.onRefusal,
        onNotice: opts.onNotice,
      });
      seen.blocks = session.blocks;
      return null;
    }
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root.render(<Probe />));
    return seen;
  }

  /* Live events go through a per-frame batcher; let it flush. */
  const flush = () => act(async () => new Promise((r) => setTimeout(r, 50)));

  it("ignores live events before the snapshot and repeats of what the snapshot holds", async () => {
    const seen = await mount();
    act(() => socket.emit({ type: "text.delta", text: "early", seq: 1 }));
    act(() =>
      socket.emit({ type: "transcript.snapshot", lastSeq: 2, events: [{ type: "text.delta", text: "a", seq: 2 }] }),
    );
    act(() => {
      socket.emit({ type: "text.delta", text: "a", seq: 2 });
      socket.emit({ type: "text.delta", text: "b", seq: 3 });
      socket.emit({ type: "text.delta", text: "b", seq: 3 });
    });
    await flush();
    const text = seen.blocks.filter((b) => b.kind === "text").map((b) => (b as { text: string }).text);
    expect(text.join("")).toBe("ab");
  });

  it("routes notices and never reduces them into the transcript", async () => {
    const refused: string[] = [];
    const noticed: string[] = [];
    const seen = await mount({ onRefusal: (m) => refused.push(m), onNotice: (m) => noticed.push(m) });
    act(() => socket.emit({ type: "transcript.snapshot", lastSeq: 0, events: [] }));
    act(() => {
      socket.emit({ type: "notice", level: "error", message: "Queue is full", about: "message" });
      socket.emit({ type: "notice", level: "warn", message: "disk slow", about: "transcript" });
    });
    await flush();
    expect(refused).toEqual(["Queue is full"]);
    expect(noticed).toEqual(["disk slow"]);
    expect(seen.blocks).toEqual([]);
  });
});
