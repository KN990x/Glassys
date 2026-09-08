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
  },
  clearToken: vi.fn(),
  getToken: () => "tok",
}));

vi.mock("./socket", () => ({
  openSocket: (handlers: { onEvent: (msg: ServerMessage) => void; onState: (s: string) => void }) => {
    socket.bind(handlers);
    return {
      send: () => true,
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
    const textarea = host.querySelector("textarea");
    expect(textarea?.getAttribute("rows")).toBe("1");
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
    await act(async () => {
      socket.emit({ type: "transcript.snapshot", events: [] });
    });
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
});
