import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, useState } from "react";
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
  setUnauthorizedHandler: vi.fn(),
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

  /** Settings is tabbed, so a section is only mounted while its tab is open. */
  async function openTab(label: string) {
    await act(async () => {
      [...host.querySelectorAll<HTMLButtonElement>(".settings-tab")]
        .find((b) => b.textContent === label)
        ?.click();
    });
  }

  it("unsubscribes push when notify is turned off", async () => {
    saveConfig.mockImplementation(async (patch: { session?: { notifyOnComplete?: boolean } }) => ({
      ...cfg(),
      session: { ...cfg().session, notifyOnComplete: patch.session?.notifyOnComplete ?? false },
    }));
    pushUnsubscribe.mockResolvedValue({ ok: true });
    await renderSettings();
    await openTab("Session");
    const notify = [...host.querySelectorAll(".setting-row")].find((el) =>
      el.textContent?.includes("Notify when a run finishes"),
    );
    const toggle = notify?.querySelector('button[role="switch"]') as HTMLButtonElement;
    expect(toggle?.getAttribute("aria-checked")).toBe("true");
    await act(async () => {
      toggle.click();
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
    await openTab("Schedules");
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

describe("Settings draft against a live config", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.body.style.overflow = "";
  });

  it("keeps an appearance edit drafted, previews it, and survives a config from elsewhere", async () => {
    const { Settings } = await import("./Settings");
    const shown: RedactedConfig[] = [];
    let push!: (c: RedactedConfig) => void;
    /* App's role: hold the config, apply what Settings previews, and receive server updates. */
    function Harness() {
      const [config, setConfig] = useState(cfg());
      push = setConfig;
      shown.push(config);
      return (
        <I18nProvider locale="en">
          <Settings config={config} onClose={() => undefined} onConfig={setConfig} onLogout={() => undefined} />
        </I18nProvider>
      );
    }
    host = document.createElement("div");
    document.body.append(host);
    await act(async () => {
      root = createRoot(host);
      root.render(<Harness />);
    });
    const name = host.querySelector("#set-host-label") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(name, "edge-01");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector(".settings-dirty")).not.toBeNull();
    expect(shown.at(-1)?.space.name).toBe("edge-01");

    /* A reconnect delivers the server's config again, with an unrelated change. */
    await act(async () => {
      push({ ...cfg(), session: { ...cfg().session, stallSeconds: 42 } });
    });
    expect((host.querySelector("#set-host-label") as HTMLInputElement).value).toBe("edge-01");
    expect(host.querySelector(".settings-dirty")).not.toBeNull();
    expect(shown.at(-1)?.space.name).toBe("edge-01");
  });
});

describe("rebaseDraft", () => {
  it("takes untouched sections from the new config and keeps edited ones", async () => {
    const { rebaseDraft, draftDiffers } = await import("./Settings");
    const base = cfg();
    const draft = { ...base, space: { ...base.space, name: "mine" } };
    const next = { ...base, session: { ...base.session, stallSeconds: 9 } };
    const rebased = rebaseDraft(draft, base, next);
    expect(rebased.space.name).toBe("mine");
    expect(rebased.session.stallSeconds).toBe(9);
    expect(draftDiffers(rebased, next)).toBe(true);
    expect(draftDiffers(next, next)).toBe(false);
  });
});
