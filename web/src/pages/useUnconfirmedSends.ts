import { useCallback, useEffect, useRef } from "react";
import type { MessageAttachment } from "@glassys/protocol";
import { MAX_ATTACHMENTS } from "@glassys/protocol";

/** How long a sent message may go unechoed before it is handed back to the composer. */
export const SEND_CONFIRM_MS = 10_000;

type Pending = { text: string; drafts: MessageAttachment[]; timer: ReturnType<typeof setTimeout> };

/**
 * Messages sent and not yet echoed back, oldest first. A socket can look open while the link is
 * dead; without this, the composer was cleared and the message silently lost. Every one is kept:
 * a second send used to replace the first, which was then lost if neither got through.
 *
 * `restore` puts them back into an empty composer, in the order sent, with the reason; it is the
 * one place the composer gets a message back.
 */
export function useUnconfirmedSends(restore: (text: string, drafts: MessageAttachment[], reason: string) => void) {
  const pending = useRef(new Map<string, Pending>());
  const restoreRef = useRef(restore);
  restoreRef.current = restore;

  /**
   * Hand back unconfirmed messages and say why. A refusal that names its message hands back only
   * that one: the others may still be accepted, and resending them would send them twice. Without a
   * name (an older gateway, a timeout) all of them.
   */
  const handBack = useCallback((reason: string, onlyId?: string) => {
    const only = onlyId ? pending.current.get(onlyId) : undefined;
    const back = only ? [only] : [...pending.current.values()];
    if (!back.length) return;
    for (const p of back) clearTimeout(p.timer);
    if (onlyId && only) pending.current.delete(onlyId);
    else pending.current.clear();
    const text = back
      .map((p) => p.text)
      .filter(Boolean)
      .join("\n\n");
    const drafts = back.flatMap((p) => p.drafts).slice(0, MAX_ATTACHMENTS);
    restoreRef.current(text, drafts, reason);
  }, []);

  /** A message just sent: if no echo comes in time, it goes back with `timeoutReason`. */
  const track = useCallback(
    (id: string, text: string, drafts: MessageAttachment[], timeoutReason: () => string) => {
      pending.current.set(id, {
        text,
        drafts,
        timer: setTimeout(() => handBack(timeoutReason()), SEND_CONFIRM_MS),
      });
    },
    [handBack],
  );

  /** The gateway echoed the message: it got through. */
  const confirmed = useCallback((id: string) => {
    const p = pending.current.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.current.delete(id);
  }, []);

  const hasPending = useCallback(() => pending.current.size > 0, []);

  useEffect(() => {
    const map = pending.current;
    return () => {
      for (const p of map.values()) clearTimeout(p.timer);
    };
  }, []);

  return { track, confirmed, handBack, hasPending };
}
