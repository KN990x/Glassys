import { beforeEach, describe, expect, it, vi } from "vitest";

const restart = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("./api", () => ({ api: { restart } }));

import { confirmAndRestart } from "./restart";

describe("confirmAndRestart", () => {
  beforeEach(() => restart.mockClear());

  it("restarts only after the operator confirms", async () => {
    const notes: string[] = [];
    await confirmAndRestart((k) => k, async () => false, (n) => notes.push(n));
    expect(restart).not.toHaveBeenCalled();
    expect(notes).toEqual([]);
    await confirmAndRestart((k) => k, async () => true, (n) => notes.push(n));
    expect(restart).toHaveBeenCalledTimes(1);
    expect(notes).toEqual(["settings.restarting"]);
  });

  it("says why a restart failed", async () => {
    restart.mockRejectedValueOnce(new Error("boom"));
    const notes: string[] = [];
    await confirmAndRestart((k) => k, async () => true, (n) => notes.push(n));
    expect(notes.at(-1)).toBe("boom");
  });
});
