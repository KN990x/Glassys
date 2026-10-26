import { afterEach, describe, expect, it } from "vitest";
import {
  LOGIN_GLOBAL_FREE_FAILURES,
  LOGIN_MAX_WAITING,
  attemptLogin,
  loginDelayMs,
  loginKey,
  resetLoginLimitForTests,
  setLoginBaseDelayForTests,
} from "./login-limit.js";

const wrong = async () => ({ ok: false, value: "wrong" as const });
const right = async () => ({ ok: true, value: "ok" as const });

async function timed(fn: () => Promise<unknown>): Promise<number> {
  const start = Date.now();
  await fn();
  return Date.now() - start;
}

describe("login limit", () => {
  afterEach(() => {
    resetLoginLimitForTests();
    setLoginBaseDelayForTests();
  });

  it("keys IPv4, IPv4-mapped and an IPv6 /64", () => {
    expect(loginKey("203.0.113.9")).toBe("203.0.113.9");
    expect(loginKey("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(loginKey("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64");
    expect(loginKey("2001:0db8:0001:0002:ffff:0:0:9")).toBe("2001:db8:1:2::/64");
    expect(loginKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
  });

  it("backs off an address after failures, and a success clears it", async () => {
    setLoginBaseDelayForTests(30);
    expect(loginDelayMs(0)).toBe(0);
    await attemptLogin("198.51.100.1", wrong);
    expect(await timed(() => attemptLogin("198.51.100.1", wrong))).toBeGreaterThanOrEqual(25);
    await attemptLogin("198.51.100.1", right);
    expect(await timed(() => attemptLogin("198.51.100.1", right))).toBeLessThan(25);
  });

  it("counts two addresses in one /64 as one client", async () => {
    setLoginBaseDelayForTests(30);
    await attemptLogin("2001:db8::1", wrong);
    expect(await timed(() => attemptLogin("2001:db8::2", wrong))).toBeGreaterThanOrEqual(25);
  });

  it("slows a fresh address once failures from everywhere pass the allowance", async () => {
    setLoginBaseDelayForTests(30);
    for (let i = 0; i < LOGIN_GLOBAL_FREE_FAILURES; i++) {
      setLoginBaseDelayForTests(0);
      await attemptLogin(`192.0.2.${i}`, wrong);
    }
    setLoginBaseDelayForTests(30);
    expect(await timed(() => attemptLogin("203.0.113.200", right))).toBeLessThan(25);
    await attemptLogin("203.0.113.201", wrong);
    expect(await timed(() => attemptLogin("203.0.113.202", right))).toBeGreaterThanOrEqual(25);
  });

  it("turns away attempts past the queue for one address", async () => {
    setLoginBaseDelayForTests(50);
    await attemptLogin("198.51.100.7", wrong);
    const pending = Array.from({ length: LOGIN_MAX_WAITING }, () => attemptLogin("198.51.100.7", wrong));
    expect(await attemptLogin("198.51.100.7", right)).toBe("busy");
    await Promise.all(pending);
  });
});
