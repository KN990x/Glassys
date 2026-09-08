import { afterEach, describe, expect, it } from "vitest";
import { cancelLoginJob, resetLoginJob, snapshotLoginJob, startLoginJob } from "./adapter-login.js";

afterEach(() => {
  resetLoginJob();
});

describe("startLoginJob", () => {
  it("returns the URL as soon as onLoginUrl fires and keeps polling in the background", async () => {
    let finish!: () => void;
    const hanging = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const started = startLoginJob("cursor", async (opts) => {
      opts?.onLoginUrl?.("https://cursor.com/login?c=1");
      await hanging;
    });
    await expect(started).resolves.toEqual({ url: "https://cursor.com/login?c=1" });
    expect(snapshotLoginJob("cursor")).toMatchObject({
      status: "waiting",
      url: "https://cursor.com/login?c=1",
    });
    finish();
    await new Promise((r) => setTimeout(r, 10));
    expect(snapshotLoginJob("cursor").status).toBe("ok");
  });

  it("returns without a URL when login finishes with no browser step", async () => {
    await expect(startLoginJob("cursor", async () => undefined)).resolves.toEqual({});
    expect(snapshotLoginJob("cursor").status).toBe("ok");
  });

  it("reuses an in-flight job for the same adapter", async () => {
    let finish!: () => void;
    const hanging = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const first = startLoginJob("cursor", async (opts) => {
      opts?.onLoginUrl?.("https://cursor.com/login?c=2");
      await hanging;
    });
    const url = await first;
    const second = await startLoginJob("cursor", async () => {
      throw new Error("should not start a second login");
    });
    expect(second).toEqual(url);
    finish();
  });

  it("cancels the SDK poll", async () => {
    const started = startLoginJob("cursor", async (opts) => {
      opts?.onLoginUrl?.("https://cursor.com/login?c=3");
      await new Promise<void>((resolve, reject) => {
        opts?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    await started;
    await cancelLoginJob();
    expect(snapshotLoginJob("cursor").status).toBe("cancelled");
  });

  it("times out if the SDK never yields a URL", async () => {
    await expect(
      startLoginJob(
        "cursor",
        async () => new Promise(() => undefined),
        30,
      ),
    ).rejects.toThrow(/Timed out waiting for the sign-in URL/);
  });
});
