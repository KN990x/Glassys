import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { defaultConfig, type RedactedConfig } from "@glassys/protocol";
import { I18nProvider } from "../i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { saveConfig, createSchedule, pushUnsubscribe } = vi.hoisted(() => ({
  saveConfig: vi.fn(),
  createSchedule: vi.fn(),
  pushUnsubscribe: vi.fn(),
}));

vi.mock("../api", () => ({
  api: {
    models: vi.fn(async () => ({ models: [{ id: "grok-4.6", displayName: "Grok 4.6" }], source: "live" })),
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
          available: { ok: true },
          auth: { loggedIn: true, apiKeyConfigured: false },
        },
      ],
    })),
    adapterStatus: vi.fn(async () => ({ loggedIn: true, apiKeyConfigured: false })),
    saveConfig,
    logout: vi.fn(),
    threads: vi.fn(async () => ({
      threads: [
        {
          id: "t1",
          title: "Live",
          adapter: "cursor",
          cwd: "/tmp/ws",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      currentId: "t1",
    })),
    usage: vi.fn(async () => ({ inputTokens: 0, outputTokens: 0, byAdapter: {}, updatedAt: "2026-01-01T00:00:00.000Z" })),
    schedules: vi.fn(async () => ({ timezone: "UTC", schedules: [] })),
    createSchedule,
    adminUpdate: vi.fn(async () => ({
      version: "0.1.0",
      service: "none",
      git: { sha: "abc", branch: "main", dirty: false },
      upgrading: { phase: "idle" },
    })),
    vapid: vi.fn(async () => ({ publicKey: "p", subject: "mailto:operator@localhost" })),
    pushSubscribe: vi.fn(async () => ({ ok: true })),
    pushUnsubscribe,
    workspaces: vi.fn(async () => ({ recents: [], pins: [], workspaces: [] })),
    reachability: vi.fn(async () => ({
      bind: "127.0.0.1",
      port: 8787,
      publicUrl: "",
      loopback: false,
      hostname: "box",
      user: "ops",
    })),
  },
  clearToken: vi.fn(),
}));

const { disableWebPush } = vi.hoisted(() => ({
  disableWebPush: vi.fn(async () => "https://push.example/a"),
}));

vi.mock("../push", () => ({
  enableWebPush: vi.fn(),
  disableWebPush,
}));

vi.mock("../components/WorkspacePicker", () => ({
  WorkspacePicker: () => <div data-testid="ws-picker" />,
}));
vi.mock("../components/Reachability", () => ({
  ReachabilityCard: () => <div data-testid="reach" />,
}));
vi.mock("../components/SdkLogin", () => ({
  SdkLoginControls: () => null,
}));
vi.mock("../components/ModelPicker", () => ({
  ModelPicker: () => <div data-testid="models" />,
  paramsForSelection: () => [],
}));

function cfg(): RedactedConfig {
  const base = defaultConfig();
  base.onboarding.completed = true;
  base.agent.cwd = "/tmp/ws";
  base.agent.adapter = "cursor";
  base.agent.model = "grok-4.6";
  base.session.notifyOnComplete = true;
  return {
    ...base,
    secrets: {
      operatorPassword: { configured: true },
      adapters: { cursor: { apiKey: { configured: false, fromEnv: false } } },
      cursorApiKey: { configured: false },
    },
  };
}

describe("Settings notify and schedules", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.body.style.overflow = "";
    saveConfig.mockReset();
    createSchedule.mockReset();
    pushUnsubscribe.mockReset();
    disableWebPush.mockClear();
  });

  async function renderSettings() {
    host = document.createElement("div");
    document.body.append(host);
    const { Settings } = await import("./Settings");
    await act(async () => {
      root = createRoot(host);
      root.render(
        <I18nProvider locale="en">
          <Settings
            config={cfg()}
            onClose={() => undefined}
            onConfig={() => undefined}
            onLogout={() => undefined}
            currentThreadId="t1"
          />
        </I18nProvider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("unsubscribes push when notify is turned off", async () => {
    saveConfig.mockImplementation(async (patch: { session?: { notifyOnComplete?: boolean } }) => ({
      ...cfg(),
      session: { ...cfg().session, notifyOnComplete: patch.session?.notifyOnComplete ?? false },
    }));
    pushUnsubscribe.mockResolvedValue({ ok: true });
    await renderSettings();
    const notify = [...host.querySelectorAll("label")].find((el) => el.textContent?.includes("Notify when a run finishes"));
    const box = notify?.querySelector("input[type='checkbox']") as HTMLInputElement;
    expect(box?.checked).toBe(true);
    await act(async () => {
      box.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(disableWebPush).toHaveBeenCalled();
    expect(pushUnsubscribe).toHaveBeenCalledWith("https://push.example/a");
    expect(saveConfig).toHaveBeenCalledWith({ session: { notifyOnComplete: false } });
  });

  it("creates a schedule with the live thread id", async () => {
    createSchedule.mockResolvedValue({ id: "s1", nextRun: null });
    await renderSettings();
    const section = host.querySelector("#settings-schedules") as HTMLElement;
    const prompt = section.querySelector("textarea") as HTMLTextAreaElement;
    const cron = [...section.querySelectorAll("input")].find((el) => el.getAttribute("placeholder") === "0 6 * * *") as HTMLInputElement;
    await act(async () => {
      const proto = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
      proto?.set?.call(prompt, "df -h");
      prompt.dispatchEvent(new Event("input", { bubbles: true }));
      const iproto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      iproto?.set?.call(cron, "0 6 * * *");
      cron.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      [...section.querySelectorAll("button")].find((b) => b.textContent === "Add schedule")?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(createSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ text: "df -h", threadId: "t1", cron: "0 6 * * *", cwd: "/tmp/ws" }),
    );
  });
});
