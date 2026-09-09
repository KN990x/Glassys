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

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 102.4) / 10} KB`;
  return `${Math.round(n / 1024 / 102.4) / 10} MB`;
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
  if (n >= 10_000) {
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
