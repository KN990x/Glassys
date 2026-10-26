import { isIPv6 } from "node:net";

/**
 * Password attempts per client address (an IPv6 client counts by its /64: one host holds the whole
 * prefix and could otherwise start fresh from every address in it). Attempts from one address run one at a time and the
 * failure count goes up before the password is checked, so parallel requests cannot all start
 * scrypt under the same count. After repeated failures each attempt waits up to 30 seconds.
 *
 * There is no hard lockout: behind a reverse proxy every client shares one address, and a lockout
 * would let anyone who reaches the login keep the operator out.
 */
export const LOGIN_FAIL_TTL_MS = 15 * 60 * 1000;
export const LOGIN_MAX_DELAY_MS = 30_000;
export const LOGIN_MAX_WAITING = 4;
/**
 * Failures from every address together. Past this many in the window, each attempt also waits as
 * if its own address had failed the excess: a guess spread over many addresses slows down too.
 * Still no lockout, so the operator gets in after the wait.
 */
export const LOGIN_GLOBAL_FREE_FAILURES = 30;
export const LOGIN_GLOBAL_WINDOW_MS = 5 * 60 * 1000;

type Failures = { count: number; at: number };
type Lane = { tail: Promise<void>; waiting: number };

const failures = new Map<string, Failures>();
const lanes = new Map<string, Lane>();
/** When each recent failure happened, oldest first, across all addresses. */
let recentFailures: number[] = [];
let baseDelayMs = 250;

export function setLoginBaseDelayForTests(ms?: number): void {
  baseDelayMs = ms ?? 250;
}

export function resetLoginLimitForTests(): void {
  failures.clear();
  lanes.clear();
  recentFailures = [];
}

function expandIPv6(ip: string): string[] {
  const [head = "", tail = ""] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = ip.includes("::") && tail ? tail.split(":") : [];
  const fill = ip.includes("::") ? Array(Math.max(0, 8 - left.length - right.length)).fill("0") : [];
  return [...left, ...fill, ...right];
}

/** The key failures count under: an IPv4 address (mapped or not), or an IPv6 /64. */
export function loginKey(ip: string): string {
  const bare = ip.replace(/%.*$/, "");
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(bare);
  if (mapped) return mapped[1]!;
  if (!isIPv6(bare)) return bare;
  const groups = expandIPv6(bare.toLowerCase());
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

function globalExcess(now: number): number {
  while (recentFailures.length && now - recentFailures[0]! > LOGIN_GLOBAL_WINDOW_MS) recentFailures.shift();
  return Math.max(0, recentFailures.length - LOGIN_GLOBAL_FREE_FAILURES);
}

function prune(now: number): void {
  for (const [ip, rec] of failures) if (now - rec.at > LOGIN_FAIL_TTL_MS) failures.delete(ip);
}

export function loginDelayMs(failed: number): number {
  if (failed <= 0) return 0;
  return Math.min(LOGIN_MAX_DELAY_MS, baseDelayMs * 2 ** Math.min(failed - 1, 16));
}

/**
 * Run one attempt for `ip`. `check` returns whether the password was right. Resolves to "busy"
 * without running it when too many attempts from that address are already waiting.
 */
export async function attemptLogin<T>(
  address: string,
  check: () => Promise<{ ok: boolean; value: T }>,
): Promise<T | "busy"> {
  const ip = loginKey(address);
  const lane = lanes.get(ip) ?? { tail: Promise.resolve(), waiting: 0 };
  if (lane.waiting >= LOGIN_MAX_WAITING) return "busy";
  lane.waiting += 1;
  lanes.set(ip, lane);
  const previous = lane.tail;
  let release: () => void = () => undefined;
  lane.tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await previous;
    const now = Date.now();
    prune(now);
    const failed = failures.get(ip)?.count ?? 0;
    const delay = Math.max(loginDelayMs(failed), loginDelayMs(globalExcess(now)));
    if (delay) await new Promise((r) => setTimeout(r, delay));
    failures.set(ip, { count: failed + 1, at: Date.now() });
    const result = await check();
    if (result.ok) failures.delete(ip);
    else {
      recentFailures.push(Date.now());
      /* Only the count past the free allowance matters; the rest is history. */
      if (recentFailures.length > LOGIN_GLOBAL_FREE_FAILURES + 64) recentFailures.shift();
    }
    return result.value;
  } finally {
    lane.waiting -= 1;
    release();
    if (lane.waiting === 0 && lanes.get(ip) === lane) lanes.delete(ip);
  }
}
