import type { TranscriptEvent } from "@glassys/protocol";
import type { ThreadMeta } from "./threads.js";

export function eventsToMarkdown(meta: ThreadMeta, events: TranscriptEvent[]): string {
  const lines: string[] = [`# ${meta.title}`, "", `- Adapter: ${meta.adapter}`, `- Workspace: ${meta.cwd}`, ""];
  for (const ev of events) {
    if (ev.type === "user.message") {
      lines.push("## Operator", "", ev.text.trim() || "(empty)", "");
      continue;
    }
    if (ev.type === "thinking.delta") {
      lines.push("### Thinking", "", ev.text, "");
      continue;
    }
    if (ev.type === "text.delta") {
      lines.push(ev.text);
      continue;
    }
    if (ev.type === "tool.start") {
      const loc = ev.path || ev.command || "";
      lines.push(`### Tool: ${ev.title}${loc ? ` (${loc})` : ""}`, "");
      continue;
    }
    if (ev.type === "tool.end") {
      if (ev.denied) lines.push("_Denied._", "");
      else if (!ev.ok) lines.push(`_Error:_ ${ev.error || "failed"}`, "");
      if (ev.outputPreview) lines.push("```", ev.outputPreview, "```", "");
      if (ev.diff) lines.push("```diff", ev.diff, "```", "");
      continue;
    }
    if (ev.type === "run.usage") {
      const parts = [
        ev.inputTokens != null ? `in ${ev.inputTokens}` : "",
        ev.outputTokens != null ? `out ${ev.outputTokens}` : "",
      ].filter(Boolean);
      if (parts.length) lines.push(`_Tokens: ${parts.join(" · ")}_`, "");
    }
  }
  return `${lines.join("\n").trim()}\n`;
}
