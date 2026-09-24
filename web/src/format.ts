import type { ThreadSummary } from "@glassys/protocol";

export function formatRelativeTime(iso: string, now = Date.now(), locale = "en"): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const diffSec = Math.round((then - now) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(locale.startsWith("es") ? "es" : "en", { numeric: "auto" });
  if (abs < 60) return rtf.format(diffSec, "second");
  if (abs < 3600) return rtf.format(Math.trunc(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.trunc(diffSec / 3600), "hour");
  if (abs < 86400 * 40) return rtf.format(Math.trunc(diffSec / 86400), "day");
  return rtf.format(Math.trunc(diffSec / (86400 * 30)), "month");
}

/**
 * Compact age for a list row: "now", "6m", "2h", "3d", then a date. The full
 * phrase ("6 minutes ago") pushed the thread title out of a 268px rail.
 */
export function formatRelativeShort(iso: string, now = Date.now(), locale = "en"): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const sec = Math.max(0, Math.round((now - then) / 1000));
  if (sec < 60) return locale.startsWith("es") ? "ahora" : "now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  if (sec < 86400 * 7) return `${Math.floor(sec / 86400)}d`;
  return new Intl.DateTimeFormat(locale.startsWith("es") ? "es" : "en", {
    month: "short",
    day: "numeric",
  }).format(then);
}

export function groupThreadsByCwd(threads: ThreadSummary[]): Array<{ cwd: string; threads: ThreadSummary[] }> {
  const order: string[] = [];
  const map = new Map<string, ThreadSummary[]>();
  for (const th of threads) {
    const cwd = th.cwd || "";
    if (!map.has(cwd)) {
      order.push(cwd);
      map.set(cwd, []);
    }
    map.get(cwd)!.push(th);
  }
  return order.map((cwd) => ({ cwd, threads: map.get(cwd)! }));
}

export function cwdBasename(cwd: string): string {
  const trimmed = cwd.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || cwd || "";
}

export function isImageMime(mime: string): boolean {
  const n = mime === "image/jpg" ? "image/jpeg" : mime;
  return n === "image/jpeg" || n === "image/png" || n === "image/webp" || n === "image/gif";
}

export function slashQuery(text: string): string | null {
  if (!text.startsWith("/")) return null;
  if (text.includes("\n")) return null;
  return text.slice(1);
}

export function blockMatchesQuery(
  block: { kind: string; text?: string; title?: string; path?: string; command?: string; chunk?: string },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [block.text, block.title, block.path, block.command, block.chunk]
    .filter((v): v is string => typeof v === "string")
    .join("\n")
    .toLowerCase();
  return hay.includes(q);
}

/** Token counts appear in four places; they all render through here. */
export function formatTokens(n: number | undefined, locale = "en"): string {
  if (!Number.isFinite(n) || n === undefined) return "0";
  const lang = locale.startsWith("es") ? "es" : "en";
  // Both sides of an in/out pair read in one format: "18.2k / 3.1k", never
  // "18.2k / 3,120".
  if (n >= 1_000) {
    const scaled = n >= 1_000_000 ? n / 1_000_000 : n / 1_000;
    const unit = n >= 1_000_000 ? "M" : "k";
    return `${new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(scaled)}${unit}`;
  }
  return new Intl.NumberFormat(lang).format(n);
}

/** Long absolute paths read better clipped in the middle than wrapped to two lines. */
export function truncateMiddle(value: string, max = 34): string {
  if (value.length <= max) return value;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

/** 1536 -> "1.5 KB", binary multiples with the units operators read in df -h. */
export function formatBytes(n: number, locale = "en"): string {
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let v = Math.max(0, n);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const lang = locale.startsWith("es") ? "es" : "en";
  const digits = v >= 100 || i === 0 ? 0 : 1;
  return `${new Intl.NumberFormat(lang, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v)} ${units[i]}`;
}

/** Uptime the way `uptime` says it, shortest units first dropped: "12d 4h", "3h 20m", "45m". */
export function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86_400);
  const h = Math.floor((sec % 86_400) / 3_600);
  const m = Math.floor((sec % 3_600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** A journal timestamp: time only when it is today, date and time otherwise. */
export function formatLogTime(ts: number, now = Date.now(), locale = "en"): string {
  const lang = locale.startsWith("es") ? "es" : "en";
  const d = new Date(ts);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  return sameDay ? time : `${d.toLocaleDateString(lang, { month: "short", day: "2-digit" })} ${time}`;
}
