import type { ToolKind } from "@glassys/protocol";
import { asRecord } from "./list.js";

export function toolKindFromName(name: string | undefined): ToolKind {
  const n = (name ?? "").toLowerCase().replace(/[_-]/g, "");
  if (n.includes("semsearch") || n.includes("semanticsearch") || n === "semsearch") return "semsearch";
  if (n === "read" || n.includes("readfile") || n === "fileread" || n === "readtextfile") return "read";
  if (n === "write" || n.includes("writefile") || n === "filewrite" || n === "writetextfile") return "write";
  if (n === "edit" || n.includes("applypatch") || n.includes("applydiff") || n.includes("stredit") || n.includes("editfile")) {
    return "edit";
  }
  if (n === "grep" || n.includes("ripgrep") || n === "search") return "grep";
  if (n === "glob" || n === "globsearch") return "glob";
  if (n === "ls" || n === "listdir") return "ls";
  if (n === "shell" || n.includes("bash") || n.includes("terminal") || n === "bash" || n === "execute") return "shell";
  if (n === "mcp" || n.startsWith("mcp") || n.includes("mcptool")) return "mcp";
  if (n === "task" || n.includes("subagent") || n === "agent") return "task";
  return "other";
}

export function diffStats(diff: string): { add: number; del: number } {
  let add = 0;
  let del = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) continue;
    if (line.startsWith("+")) add += 1;
    else if (line.startsWith("-")) del += 1;
  }
  return { add, del };
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export function looksLikeDiff(text: string): boolean {
  return /^(diff --git |--- |\+\+\+ |@@ )/m.test(text);
}

export function unifiedFromReplacement(path: string, oldText: string, newText: string): string {
  const file = path || "file";
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const oldBody = oldLines.map((line) => `-${line}`).join("\n");
  const newBody = newLines.map((line) => `+${line}`).join("\n");
  return `--- a/${file}\n+++ b/${file}\n@@ -1,${oldLines.length} +1,${newLines.length} @@\n${oldBody}\n${newBody}`;
}

/** Pull a unified diff out of an SDK payload when the vendor already provided one. */
export function extractDiff(value: unknown): { diff?: string; stats?: { add: number; del: number }; truncated?: boolean } {
  if (typeof value === "string") {
    return looksLikeDiff(value) ? { diff: value, stats: diffStats(value) } : {};
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractDiff(item);
      if (found.diff) return found;
    }
    return {};
  }
  const rec = asRecord(value);
  if (!rec) return {};
  const truncated = rec.truncated === true || asRecord(rec.truncated)?.result === true;
  const nested = asRecord(rec.result) ?? asRecord(rec.content);
  const diff =
    str(rec.diff) ||
    str(rec.diffString) ||
    str(rec.patch) ||
    str(rec.unifiedDiff) ||
    (nested && (str(nested.diff) || str(nested.diffString) || str(nested.patch)));
  if (diff) return { diff, stats: diffStats(diff), truncated: truncated || undefined };
  if (typeof rec.content === "string" && looksLikeDiff(rec.content)) {
    return { diff: rec.content, stats: diffStats(rec.content), truncated: truncated || undefined };
  }
  if (Array.isArray(rec.content)) {
    const fromContent = extractDiff(rec.content);
    if (fromContent.diff) return { ...fromContent, truncated: fromContent.truncated || truncated || undefined };
  }
  const type = str(rec.type);
  if (type === "diff") {
    const path = str(rec.path) || "file";
    const oldText = typeof rec.oldText === "string" ? rec.oldText : "";
    const newText = typeof rec.newText === "string" ? rec.newText : "";
    const unified = unifiedFromReplacement(path, oldText, newText);
    return { diff: unified, stats: diffStats(unified), truncated: truncated || undefined };
  }
  return truncated ? { truncated: true } : {};
}

export function toolDenied(status?: string, error?: string): boolean {
  const s = (status || "").toLowerCase();
  const e = (error || "").toLowerCase();
  return (
    s === "denied" ||
    s === "rejected" ||
    s === "cancelled" ||
    e.includes("denied") ||
    e.includes("auto-review") ||
    e.includes("auto review") ||
    e.includes("cancelled")
  );
}

export function promptWithAttachments(
  text: string,
  attachments?: { path: string; mime: string; name: string }[],
): string {
  if (!attachments?.length) return text;
  const lines = attachments.map((a) => `- ${a.name} (${a.mime}): ${a.path}`);
  const note = `The user attached ${attachments.length} image(s) at these absolute paths:\n${lines.join("\n")}`;
  return text.trim() ? `${text.trim()}\n\n${note}` : note;
}
