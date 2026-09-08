import type { MessageAttachment } from "@glassys/protocol";

const prefix = "glassys_draft:";

export function loadDraft(threadId: string | null): { text: string; attachments: MessageAttachment[] } {
  if (!threadId) return { text: "", attachments: [] };
  try {
    const raw = sessionStorage.getItem(prefix + threadId);
    if (!raw) return { text: "", attachments: [] };
    const parsed = JSON.parse(raw) as { text?: unknown; attachments?: unknown };
    const text = typeof parsed.text === "string" ? parsed.text : "";
    const attachments = Array.isArray(parsed.attachments)
      ? parsed.attachments.filter(
          (a): a is MessageAttachment =>
            Boolean(a) &&
            typeof a === "object" &&
            typeof (a as MessageAttachment).id === "string" &&
            typeof (a as MessageAttachment).mime === "string" &&
            typeof (a as MessageAttachment).name === "string",
        )
      : [];
    return { text, attachments };
  } catch {
    return { text: "", attachments: [] };
  }
}

export function saveDraft(threadId: string | null, text: string, attachments: MessageAttachment[]): void {
  if (!threadId) return;
  try {
    if (!text && !attachments.length) {
      sessionStorage.removeItem(prefix + threadId);
      return;
    }
    sessionStorage.setItem(prefix + threadId, JSON.stringify({ text, attachments }));
  } catch {
    /* quota / private mode */
  }
}
