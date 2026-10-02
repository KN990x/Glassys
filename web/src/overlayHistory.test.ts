import { afterEach, describe, expect, it, vi } from "vitest";
import { overlayPopped, popOverlay, pushOverlay } from "./overlayHistory";

describe("overlay history", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    overlayPopped();
  });

  it("goes back once even if two handlers close the same overlay", () => {
    pushOverlay("threads");
    const back = vi.spyOn(history, "back").mockImplementation(() => undefined);
    popOverlay();
    popOverlay();
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("can close again after popstate lands", () => {
    pushOverlay("threads");
    const back = vi.spyOn(history, "back").mockImplementation(() => undefined);
    popOverlay();
    overlayPopped();
    popOverlay();
    expect(back).toHaveBeenCalledTimes(2);
  });

  it("does nothing when no overlay owns the entry", () => {
    history.replaceState(null, "");
    const back = vi.spyOn(history, "back").mockImplementation(() => undefined);
    popOverlay();
    expect(back).not.toHaveBeenCalled();
  });
});
