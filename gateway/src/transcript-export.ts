import type { TranscriptEvent } from "@glassys/protocol";
import type { ThreadMeta } from "./threads.js";

export function coalesceTranscriptEvents(events: TranscriptEvent[]): TranscriptEvent[] {
  const out: TranscriptEvent[] = [];
  for (const ev of events) {
    const last = out[out.length - 1];
    if (ev.type === "text.delta" && last?.type === "text.delta") {
      out[out.length - 1] = { type: "text.delta", text: last.text + ev.text };
      continue;
    }
    if (ev.type === "thinking.delta" && last?.type === "thinking.delta") {
      out[out.length - 1] = { type: "thinking.delta", text: last.text + ev.text };
      continue;
    }
    out.push(ev);
  }
  return out;
}

export function eventsToMarkdown(meta: ThreadMeta, events: TranscriptEvent[]): string {
  const lines: string[] = [`# ${meta.title}`, "", `- Adapter: ${meta.adapter}`, `- Workspace: ${meta.cwd}`, ""];
  const retracted = new Set(
    events.filter((ev) => ev.type === "user.retracted").map((ev) => (ev.type === "user.retracted" ? ev.id : "")),
  );
  for (const ev of coalesceTranscriptEvents(events)) {
    if (ev.type === "user.retracted") continue;
    if (ev.type === "user.message") {
      if (ev.id && retracted.has(ev.id)) continue;
      lines.push("## Operator", "", ev.text.trim() || "(empty)", "");
      continue;
    }
    if (ev.type === "thinking.delta") {
      lines.push("### Thinking", "", ev.text, "");
      continue;
    }
    if (ev.type === "text.delta") {
      lines.push(ev.text, "");
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
