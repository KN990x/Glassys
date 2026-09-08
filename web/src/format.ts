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
