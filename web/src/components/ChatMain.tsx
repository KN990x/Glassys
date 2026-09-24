import type { RefObject } from "react";
import { useT } from "../i18n";
import { AlertStack, type Alert } from "./AlertStack";
import { Transcript, type TranscriptProps } from "./Transcript";
import { IconArrowDown } from "./Icon";

/**
 * The chat's centre: alerts, then the transcript in its scroller, with the
 * jump-to-latest button while the operator is scrolled up. Scroll position and
 * pinning stay with the caller, which also streams into the transcript.
 */
export function ChatMain({
  alerts,
  notices,
  scrollerRef,
  onScroll,
  atBottom,
  onJumpBottom,
  transcript,
}: {
  alerts: Alert[];
  /** A second stack for notes about the transcript itself, such as truncation. */
  notices: Alert[];
  scrollerRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  atBottom: boolean;
  onJumpBottom: () => void;
  transcript: TranscriptProps;
}) {
  const t = useT();
  return (
    <main className="chat-main">
      <h1 className="visually-hidden">{t("app.name")}</h1>
      <AlertStack alerts={alerts} />
      <AlertStack alerts={notices} />
      <div className="transcript" ref={scrollerRef} onScroll={onScroll}>
        <div className="transcript-inner">
          <Transcript {...transcript} />
        </div>
        {!atBottom && (
          <button
            type="button"
            className="ghost jump-bottom"
            aria-label={t("chat.jumpBottom")}
            title={t("chat.jumpBottom")}
            onClick={onJumpBottom}
          >
            <IconArrowDown />
          </button>
        )}
      </div>
    </main>
  );
}
