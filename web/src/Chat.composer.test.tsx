import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { defaultConfig, type RedactedConfig, type ServerMessage } from "@glassys/protocol";
import { I18nProvider } from "./i18n";
import "./styles.css";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { saveConfig } = vi.hoisted(() => ({ saveConfig: vi.fn() }));

const socket = vi.hoisted(() => {
  let onEvent: ((msg: ServerMessage) => void) | undefined;
  let onState: ((s: string) => void) | undefined;
  return {
    sent: [] as unknown[],
    emit(msg: ServerMessage) {
      onEvent?.(msg);
    },
    setConnected() {
      onState?.("connected");
    },
    bind(handlers: { onEvent: (msg: ServerMessage) => void; onState: (s: string) => void }) {
      onEvent = handlers.onEvent;
      onState = handlers.onState;
    },
  };
});

vi.mock("./api", () => ({
  api: {
    models: vi.fn(async () => ({
      models: [
        { id: "grok-4.6", displayName: "Grok 4.6" },
        { id: "composer-2.5", displayName: "Composer" },
      ],
      source: "live",
    })),
    adapters: vi.fn(async () => ({
      adapters: [
        {
          id: "cursor",
          displayName: "Cursor",
          capabilities: {
            models: true,
            sandbox: true,
            settingSources: true,
            autoRun: true,
            cancel: true,
            resume: true,
            discover: false,
            toolConfirmation: "auto-review-deny",
            auth: { kind: "sdk-login", envNames: [] },
            liveCatalog: true,
          },
          auth: { loggedIn: true, apiKeyConfigured: false },
        },
      ],
    })),
    saveConfig: (...args: unknown[]) => saveConfig(...args),
    logout: vi.fn(),
    threads: vi.fn(async () => ({ threads: [], currentId: null })),
    newThread: vi.fn(async () => ({ threads: [], currentId: null })),
    switchThread: vi.fn(async () => ({ threads: [], currentId: null })),
    deleteThread: vi.fn(async () => ({ threads: [], currentId: null })),
    restart: vi.fn(async () => ({ ok: true })),
    renameThread: vi.fn(async () => ({ threads: [], currentId: null })),
    exportThread: vi.fn(async () => ({ blob: new Blob(["# t"]), name: "t.md" })),
    upload: vi.fn(async (file: File) => ({ id: `up-${file.name}`, mime: file.type, name: file.name })),
    reachability: vi.fn(async () => ({
      bind: "127.0.0.1",
      port: 8787,
      publicUrl: "",
      loopback: true,
      hostname: "box",
      user: "ops",
    })),
    workspaces: vi.fn(async () => ({ recents: [], pins: [], workspaces: [] })),
    pinWorkspaces: vi.fn(async (pins: string[]) => ({ pins })),
    openWorkspace: vi.fn(async () => ({ threads: [], currentId: null, config: {} })),
    createSchedule: vi.fn(async () => ({ id: "s1", nextRun: null })),
    upgrade: vi.fn(async () => ({ ok: true, upgrading: true })),
  },
  clearToken: vi.fn(),
  getToken: () => "tok",
}));

vi.mock("./pages/Settings", () => ({
  Settings: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="settings-stub">
      <button type="button" onClick={onClose}>
        Close settings
      </button>
    </div>
  ),
}));

vi.mock("./socket", () => ({
  openSocket: (handlers: { onEvent: (msg: ServerMessage) => void; onState: (s: string) => void }) => {
    socket.bind(handlers);
    return {
      send: (msg: unknown) => {
        socket.sent.push(msg);
        return true;
      },
      close: () => undefined,
      setKeepalive: () => undefined,
    };
  },
}));

function cfg(): RedactedConfig {
  const base = defaultConfig();
  base.onboarding.completed = true;
  base.agent.cwd = "/tmp/ws";
  base.agent.adapter = "cursor";
  base.agent.model = "grok-4.6";
  return {
    ...base,
    secrets: {
      operatorPassword: { configured: true },
      adapters: {},
      cursorApiKey: { configured: false },
    },
  };
}

async function typeIn(el: HTMLTextAreaElement, value: string) {
  await act(async () => {
    const proto = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
    proto?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Chat composer and layout", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    saveConfig.mockReset();
    socket.sent.length = 0;
    vi.unstubAllGlobals();
    sessionStorage.removeItem("glassys.hideLoopback");
  });

  async function renderChat() {
    host = document.createElement("div");
    document.body.append(host);
    const { Chat } = await import("./pages/Chat");
    const config = cfg();
    await act(async () => {
      root = createRoot(host);
      root.render(
        <I18nProvider locale="en">
          <Chat config={config} onConfig={() => undefined} onLogout={() => undefined} />
        </I18nProvider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    return config;
  }

  it("keeps the selected model while saveConfig is in flight", async () => {
    let finish!: (value: RedactedConfig) => void;
    saveConfig.mockImplementation(
      () =>
        new Promise<RedactedConfig>((resolve) => {
          finish = resolve;
        }),
    );
    const config = await renderChat();
    const select = host.querySelector("select");
    expect(select).toBeTruthy();
    await act(async () => {
      select!.value = "composer-2.5";
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect((host.querySelector("select") as HTMLSelectElement).value).toBe("composer-2.5");
    await act(async () => {
      finish({ ...config, agent: { ...config.agent, model: "composer-2.5" } });
      await Promise.resolve();
    });
  });

  it("keeps user bubbles inside the same column as the title", async () => {
    await renderChat();
    await act(async () => {
      socket.setConnected();
      socket.emit({ type: "transcript.snapshot", events: [{ type: "user.message", text: "hi" }] });
    });
    expect(host.querySelector(".topbar-inner")).toBeTruthy();
    expect(host.querySelector(".transcript-inner")).toBeTruthy();
    expect(host.querySelector(".transcript-inner .bubble.user")?.textContent).toBe("hi");
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea?.getAttribute("rows")).toBe("1");
    expect(textarea.style.height).toBe("");
  });

  it("resets composer height when the input is cleared", async () => {
    const { resizeComposer } = await import("./pages/Chat");
    const el = document.createElement("textarea");
    el.value = "hello\nworld";
    resizeComposer(el);
    expect(el.style.height).not.toBe("");
    el.value = "";
    resizeComposer(el);
    expect(el.style.height).toBe("");
  });

  it("does not enable send until the transcript snapshot arrives", async () => {
    await renderChat();
    await act(async () => {
      socket.setConnected();
    });
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    const send = () => host.querySelector('button[type="submit"]') as HTMLButtonElement;
    await typeIn(textarea, "hello");
    expect(send().disabled).toBe(true);
    expect(host.querySelector(".empty")?.textContent).toMatch(/connecting/i);
    await act(async () => {
      socket.emit({ type: "transcript.snapshot", events: [] });
    });
    expect(host.querySelector(".empty")?.textContent).toBeTruthy();
    await typeIn(host.querySelector("textarea") as HTMLTextAreaElement, "hello");
    expect(send().disabled).toBe(false);
  });

  it("stacks composer fallback below the picker instead of beside it", async () => {
    const { api } = await import("./api");
    vi.mocked(api.models).mockResolvedValueOnce({
      models: [{ id: "grok-4.6", displayName: "Grok 4.6" }],
      source: "fallback",
      error: "API key is required for cloud operations. Set CURSOR_API_KEY, pass apiKey, or run Cursor.auth.login().",
    });
    await renderChat();
    const meta = host.querySelector(".composer-meta");
    expect(meta).toBeTruthy();
    const warn = meta?.querySelector(".warn");
    expect(warn?.tagName).toBe("P");
    expect(warn?.textContent).toBe("Using fallback catalog");
    expect(warn?.textContent).not.toMatch(/CURSOR_API_KEY/);
    expect(meta?.querySelector(".composer-hint")).toBeNull();
    expect(warn?.previousElementSibling?.classList.contains("model-picker")).toBe(true);
    expect(meta?.querySelector("p.warn")?.parentElement).toBe(meta);
  });

  it("does not refetch adapters when Settings opens and closes", async () => {
    const { api } = await import("./api");
    vi.mocked(api.adapters).mockClear();
    await renderChat();
    expect(api.adapters).toHaveBeenCalledTimes(1);
    await act(async () => {
      [...host.querySelectorAll("button")].find((b) => b.textContent === "Settings")?.click();
    });
    expect(host.querySelector('[data-testid="settings-stub"]')).toBeTruthy();
    expect(api.adapters).toHaveBeenCalledTimes(1);
    await act(async () => {
      [...host.querySelectorAll("button")].find((b) => b.textContent === "Close settings")?.click();
    });
    expect(host.querySelector('[data-testid="settings-stub"]')).toBeNull();
    expect(api.adapters).toHaveBeenCalledTimes(1);
  });

  it("shows adapter and cwd in the desktop thread rail", async () => {
    const { api } = await import("./api");
    vi.mocked(api.threads).mockResolvedValueOnce({
      threads: [
        {
          id: "t1",
          title: "ws",
          adapter: "cursor",
          cwd: "/tmp/ws",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      currentId: "t1",
    });
    await renderChat();
    const rail = host.querySelector(".sidebar")?.textContent ?? "";
    expect(rail).toContain("cursor");
    expect(rail).toContain("/tmp/ws");
  });

  it("shows the host user and hostname in the topbar", async () => {
    await renderChat();
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.querySelector(".host-context")?.textContent).toContain("ops@box");
  });

  it("applies threads.snapshot without a page reload", async () => {
    await renderChat();
    await act(async () => {
      socket.emit({
        type: "threads.snapshot",
        threads: [
          {
            id: "t2",
            title: "ops",
            adapter: "cursor",
            cwd: "/opt/stack",
            updatedAt: "2026-01-02T00:00:00.000Z",
          },
        ],
        currentId: "t2",
      });
    });
    const rail = host.querySelector(".sidebar")?.textContent ?? "";
    expect(rail).toContain("/opt/stack");
    expect(rail).toContain("ops");
  });

  it("shows Working and queued together when a run and the FIFO both have work", async () => {
    await renderChat();
    await act(async () => {
      socket.setConnected();
      socket.emit({ type: "transcript.snapshot", events: [] });
      socket.emit({ type: "session", profileId: "default", agentId: "a", busy: true, threadId: "t1" });
      socket.emit({ type: "queue.snapshot", items: [{ id: "q1", text: "later" }] });
    });
    expect(host.querySelector(".status")?.textContent).toBe("Working · queued");
  });

  it("attaches pasted images from the composer", async () => {
    const { api } = await import("./api");
    await renderChat();
    await act(async () => {
      socket.setConnected();
      socket.emit({ type: "transcript.snapshot", events: [] });
    });
    const file = new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" });
    const form = host.querySelector("form.composer") as HTMLFormElement;
    await act(async () => {
      const ev = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(ev, "clipboardData", { value: { files: [file] } });
      form.dispatchEvent(ev);
    });
    expect(api.upload).toHaveBeenCalled();
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.querySelector(".draft-thumbs img")?.getAttribute("alt")).toBe("shot.png");
  });

  it("does not send on Enter when the device has a touch screen", async () => {
    vi.stubGlobal("navigator", { maxTouchPoints: 5 });
    await renderChat();
    await act(async () => {
      socket.setConnected();
      socket.emit({ type: "transcript.snapshot", events: [] });
    });
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    await typeIn(textarea, "hello");
    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(textarea.value).toBe("hello");
  });

  it("opens slash templates at the start of the composer and inserts without sending", async () => {
    await renderChat();
    await act(async () => {
      socket.setConnected();
      socket.emit({ type: "transcript.snapshot", events: [] });
    });
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    await typeIn(textarea, "hello /status");
    expect(host.querySelector(".palette-inline")).toBeNull();
    await typeIn(textarea, "/status");
    expect(host.querySelector(".palette-inline")).toBeTruthy();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toMatch(/systemd|launchd|failed units/i);
    expect(socket.sent.some((m) => (m as { type?: string }).type === "user.message")).toBe(false);
  });

  it("shows ops chips on an empty composer and inserts without sending", async () => {
    await renderChat();
    await act(async () => {
      socket.setConnected();
      socket.emit({ type: "transcript.snapshot", events: [] });
    });
    const chips = host.querySelector(".ops-chips");
    expect(chips?.textContent).toContain("/status");
    expect(chips?.textContent).toContain("/disk");
    expect(chips?.textContent).toContain("/failed-units");
    await act(async () => {
      [...chips!.querySelectorAll("button")].find((b) => b.textContent === "/status")?.click();
    });
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toMatch(/systemd|launchd|failed units/i);
    expect(socket.sent.some((m) => (m as { type?: string }).type === "user.message")).toBe(false);
  });

  it("dismisses the loopback banner for the tab", async () => {
    await renderChat();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toMatch(/loopback/i);
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')?.click();
    });
    expect(host.textContent).not.toMatch(/loopback/i);
    expect(sessionStorage.getItem("glassys.hideLoopback")).toBe("1");
  });

  it("shows a truncated transcript banner", async () => {
    await renderChat();
    await act(async () => {
      socket.setConnected();
      socket.emit({ type: "transcript.snapshot", events: [], truncated: true });
    });
    expect(host.textContent).toMatch(/omitted/i);
  });

  it("caps attachments at four before upload", async () => {
    const { api } = await import("./api");
    vi.mocked(api.upload).mockClear();
    await renderChat();
    await act(async () => {
      socket.setConnected();
      socket.emit({ type: "transcript.snapshot", events: [] });
    });
    const files = [1, 2, 3, 4, 5].map((n) => new File([`x${n}`], `f${n}.txt`, { type: "text/plain" }));
    const form = host.querySelector("form.composer") as HTMLFormElement;
    await act(async () => {
      const ev = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(ev, "dataTransfer", { value: { files, types: ["Files"] } });
      form.dispatchEvent(ev);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(vi.mocked(api.upload).mock.calls.length).toBe(4);
    expect(host.textContent).toMatch(/too many attachments/i);
  });

  it("opens Settings for upgrade instead of calling the API from the palette", async () => {
    const { api } = await import("./api");
    await renderChat();
    await act(async () => {
      socket.setConnected();
      socket.emit({ type: "transcript.snapshot", events: [] });
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    });
    expect(host.querySelector(".palette-overlay")).toBeTruthy();
    await act(async () => {
      const btn = [...host.querySelectorAll<HTMLButtonElement>(".palette-list button")].find((b) =>
        b.textContent?.includes("Upgrade Glassys"),
      );
      btn?.click();
    });
    expect(api.upgrade).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="settings-stub"]')).toBeTruthy();
  });
});
