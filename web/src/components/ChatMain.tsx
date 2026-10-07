import { useEffect, useEffectEvent, type RefObject } from "react";
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
  onResize,
  atBottom,
  onJumpBottom,
  transcript,
}: {
  alerts: Alert[];
  /** A second stack for notes about the transcript itself, such as truncation. */
  notices: Alert[];
  scrollerRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  /** The scroller or its content changed size without a scroll: a banner above it, a late font. */
  onResize: () => void;
  atBottom: boolean;
  onJumpBottom: () => void;
  transcript: TranscriptProps;
}) {
  const t = useT();
  const resized = useEffectEvent(onResize);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => resized());
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [scrollerRef]);
  return (
    <main className="chat-main">
      <h1 className="visually-hidden">{t("app.name")}</h1>
      <AlertStack alerts={alerts} />
      <AlertStack alerts={notices} />
      <div className="transcript" ref={scrollerRef} onScroll={onScroll}>
        {/* A log, but not a live one: streamed tokens would be read one by one.
            Transcript announces each reply once it closes. */}
        <div className="transcript-inner" role="log" aria-live="off" aria-label={t("chat.transcript")}>
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
