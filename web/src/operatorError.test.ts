import { describe, expect, it } from "vitest";
import { operatorError } from "./operatorError";

describe("operatorError", () => {
  it("maps stable gateway codes and leaves model text alone", () => {
    const t = (key: string) => `i18n:${key}`;
    expect(operatorError("busy", t)).toBe("i18n:threads.busy");
    expect(operatorError("unauthorized", t)).toBe("i18n:error.unauthorized");
    expect(operatorError("invalid json", t)).toBe("i18n:error.invalidJson");
    expect(operatorError("unknown message", t)).toBe("i18n:error.unknownMessage");
    expect(operatorError("title required", t)).toBe("i18n:error.titleRequired");
    expect(operatorError("payload too large", t)).toBe("i18n:error.payloadTooLarge");
    expect(operatorError("Workspace path does not exist", t)).toBe("i18n:error.cwdMissing");
    expect(operatorError("Queue is full", t)).toBe("i18n:error.queueFull");
    expect(operatorError("Gateway is busy, try again", t)).toBe("i18n:error.gatewayBusy");
    expect(operatorError("invalid subscription", t)).toBe("i18n:error.invalidSubscription");
    expect(operatorError("Too many schedules", t)).toBe("i18n:error.tooManySchedules");
    expect(operatorError("Invalid cron expression", t)).toBe("i18n:error.invalidCron");
    expect(operatorError("model said something", t)).toBe("model said something");
  });
});
