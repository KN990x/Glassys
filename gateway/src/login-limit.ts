/**
 * Password attempts per client address. Attempts from one address run one at a time and the
 * failure count goes up before the password is checked, so parallel requests cannot all start
 * scrypt under the same count. After repeated failures each attempt waits up to 30 seconds.
 *
 * There is no hard lockout: behind a reverse proxy every client shares one address, and a lockout
 * would let anyone who reaches the login keep the operator out.
 */
export const LOGIN_FAIL_TTL_MS = 15 * 60 * 1000;
export const LOGIN_MAX_DELAY_MS = 30_000;
export const LOGIN_MAX_WAITING = 4;

type Failures = { count: number; at: number };
type Lane = { tail: Promise<void>; waiting: number };

const failures = new Map<string, Failures>();
const lanes = new Map<string, Lane>();
let baseDelayMs = 250;

export function setLoginBaseDelayForTests(ms?: number): void {
  baseDelayMs = ms ?? 250;
}

export function resetLoginLimitForTests(): void {
  failures.clear();
  lanes.clear();
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
  ip: string,
  check: () => Promise<{ ok: boolean; value: T }>,
): Promise<T | "busy"> {
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
    const delay = loginDelayMs(failed);
    if (delay) await new Promise((r) => setTimeout(r, delay));
    failures.set(ip, { count: failed + 1, at: Date.now() });
    const result = await check();
    if (result.ok) failures.delete(ip);
    return result.value;
  } finally {
    lane.waiting -= 1;
    release();
    if (lane.waiting === 0 && lanes.get(ip) === lane) lanes.delete(ip);
  }
}
