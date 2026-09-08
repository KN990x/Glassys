import { afterEach, describe, expect, it, vi } from "vitest";
import { operatorError, shouldSubmitOnEnter } from "./operatorError";

describe("operatorError", () => {
  it("maps stable gateway codes and leaves model text alone", () => {
    const t = (key: string) => `i18n:${key}`;
    expect(operatorError("busy", t)).toBe("i18n:threads.busy");
    expect(operatorError("unauthorized", t)).toBe("i18n:error.unauthorized");
    expect(operatorError("invalid json", t)).toBe("i18n:error.invalidJson");
    expect(operatorError("unknown message", t)).toBe("i18n:error.unknownMessage");
    expect(operatorError("title required", t)).toBe("i18n:error.titleRequired");
    expect(operatorError("payload too large", t)).toBe("i18n:error.payloadTooLarge");
    expect(operatorError("Attachments could not be read", t)).toBe("i18n:error.attachments");
    expect(operatorError("model said something", t)).toBe("model said something");
  });
});

describe("shouldSubmitOnEnter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("submits on Enter on a desktop keyboard", () => {
    vi.stubGlobal("navigator", { maxTouchPoints: 0 });
    expect(shouldSubmitOnEnter({ key: "Enter", shiftKey: false })).toBe(true);
    expect(shouldSubmitOnEnter({ key: "Enter", shiftKey: true })).toBe(false);
    expect(shouldSubmitOnEnter({ key: "Enter", shiftKey: false, nativeEvent: { isComposing: true } })).toBe(false);
  });

  it("does not submit on Enter when the device has a touch screen", () => {
    vi.stubGlobal("navigator", { maxTouchPoints: 5 });
    expect(shouldSubmitOnEnter({ key: "Enter", shiftKey: false })).toBe(false);
  });
});
