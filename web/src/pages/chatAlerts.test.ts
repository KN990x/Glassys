import { describe, expect, it, vi } from "vitest";
import { chatAlerts } from "./chatAlerts";

const base = {
  t: (k: string) => k,
  protocolError: null,
  configError: "",
  newVersion: false,
  restartRequired: false,
  restartNote: "",
  onRestart: () => undefined,
};

describe("chatAlerts", () => {
  it("shows nothing when all is well", () => {
    expect(chatAlerts(base)).toEqual([]);
  });

  it("puts the protocol and config errors first, and only dismissable ones get a dismiss", () => {
    const dismiss = vi.fn();
    const alerts = chatAlerts({
      ...base,
      protocolError: 2,
      configError: "bad config",
      send: { text: "not sent", dismiss },
      loopback: { dismiss },
    });
    expect(alerts.map((a) => a.id)).toEqual(["protocol", "config", "loopback", "send"]);
    expect(alerts[0]?.onDismiss).toBeUndefined();
    alerts[3]?.onDismiss?.();
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("offers a restart when one is required, and keeps a note alone otherwise", () => {
    const onRestart = vi.fn();
    const required = chatAlerts({ ...base, restartRequired: true, restartNote: "Restarting…", onRestart });
    expect(required).toMatchObject([{ id: "restart", text: "settings.restartRequired Restarting…" }]);
    required[0]?.action?.run();
    expect(onRestart).toHaveBeenCalled();
    expect(chatAlerts({ ...base, restartNote: "Restarting…" })).toMatchObject([{ id: "restart-note", tone: "info" }]);
  });
});
