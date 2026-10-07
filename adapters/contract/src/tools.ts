import type { ToolKind } from "@glassys/protocol";
import { asRecord } from "./list.js";
import { diffStats, unifiedDiff } from "./diff.js";
import { str } from "./util.js";

export { diffStats };

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

export function looksLikeDiff(text: string): boolean {
  return /^(diff --git |--- |\+\+\+ |@@ )/m.test(text);
}

/** Whole-file replacement as a unified diff (diffed line by line, not one big hunk). */
export function unifiedFromReplacement(path: string, oldText: string | null | undefined, newText: string): string {
  return unifiedDiff(path, oldText, newText);
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
    const oldText = typeof rec.oldText === "string" ? rec.oldText : null;
    const newText = typeof rec.newText === "string" ? rec.newText : "";
    const unified = unifiedFromReplacement(path, oldText, newText);
    return { diff: unified, stats: diffStats(unified), truncated: truncated || undefined };
  }
  return truncated ? { truncated: true } : {};
}

/**
 * Whether a tool call was refused by a permission policy (Auto-review, auto-run off, a deny
 * rule). A call cut short by the operator's cancel is not a denial.
 */
export function toolDenied(status?: string, error?: string): boolean {
  const s = (status || "").toLowerCase();
  const e = (error || "").toLowerCase();
  return (
    s === "denied" ||
    s === "rejected" ||
    e.includes("denied") ||
    e.includes("not allowed") ||
    e.includes("rejected permission") ||
    e.includes("auto-review") ||
    e.includes("auto review")
  );
}

export function promptWithAttachments(
  text: string,
  attachments?: { path: string; mime: string; name: string }[],
): string {
  if (!attachments?.length) return text;
  const lines = attachments.map((a) => `- ${a.name} (${a.mime}): ${a.path}`);
  const note = `The user attached ${attachments.length} file(s) at these absolute paths:\n${lines.join("\n")}`;
  return text.trim() ? `${text.trim()}\n\n${note}` : note;
}

export function imagePartsFromAttachments(
  attachments?: { mime: string; name: string; body?: Buffer }[],
): Array<{ mime: string; name: string; data: string }> {
  if (!attachments?.length) return [];
  return attachments
    .filter((a) => a.body && a.body.length > 0 && a.mime.startsWith("image/"))
    .map((a) => ({ mime: a.mime, name: a.name, data: a.body!.toString("base64") }));
}
