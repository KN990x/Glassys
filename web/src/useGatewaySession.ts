import { useCallback, useEffect, useRef, useState } from "react";
import {
  isTranscriptEvent,
  type ClientMessage,
  type QueueItem,
  type RedactedConfig,
  type ServerMessage,
  type ThreadSummary,
  type TranscriptEvent,
} from "@glassys/protocol";
import { api } from "./api";
import { createEventBatcher } from "./eventBatch";
import { openSocket, type ConnState } from "./socket";
import { reduceTranscriptBatch, replay, type Block } from "./transcript";

/**
 * The chat's live session with the gateway: the WebSocket and everything it feeds (the
 * transcript, the run and its queue, the thread list, the connection itself). Chat renders it;
 * it used to be one 100-line effect inside a 1,300-line component.
 */
export function useGatewaySession(opts: {
  keepaliveSeconds: number;
  onConfig: (config: RedactedConfig) => void;
  onLogout: () => void;
  /** The gateway echoed a message this screen sent (or took it back). */
  onEcho?: (id: string) => void;
  /** A refusal addressed to this socket alone: queue full, gateway busy, onboarding. */
  onRefusal?: (message: string) => void;
  /** A config.error for this socket. */
  onConfigError?: (message: string) => void;
}) {
  const [conn, setConn] = useState<ConnState>("connecting");
  const [protocolError, setProtocolError] = useState<number | null>(null);
  const [newVersion, setNewVersion] = useState(false);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [snapshotReady, setSnapshotReady] = useState(false);
  const [transcriptTruncated, setTranscriptTruncated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [runStartedAt, setRunStartedAt] = useState<number | undefined>();
  const [queued, setQueued] = useState(false);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);

  const snapshotReadyRef = useRef(false);
  /** Snapshots received so far; a thread change that fails only rolls back if none came meanwhile. */
  const snapshotCount = useRef(0);
  /* The gateway commit this page loaded against; a reconnect to another one means an upgrade. */
  const gatewayCommit = useRef<string | undefined>(undefined);
  const sendRef = useRef<(msg: ClientMessage) => boolean>(() => false);
  const keepaliveRef = useRef<(seconds: number) => void>(() => undefined);
  const latest = useRef(opts);
  latest.current = opts;

  useEffect(() => {
    /* One batch per frame; a snapshot replaces the transcript and drops what is pending. */
    const batcher = createEventBatcher<TranscriptEvent>((batch) => setBlocks((cur) => reduceTranscriptBatch(cur, batch)));
    /* The newest persisted event this screen holds; anything at or below it is a repeat. */
    let lastSeq = 0;
    const sock = openSocket({
      onState: (s) => {
        if (s === "connecting" || s === "reconnecting") {
          snapshotReadyRef.current = false;
          setSnapshotReady(false);
        }
        setConn(s);
      },
      onEvent: (msg: ServerMessage) => {
        const o = latest.current;
        if (msg.type === "auth.error") {
          void api.logout().finally(() => latest.current.onLogout());
          return;
        }
        if (msg.type === "hello.incompatible") {
          setProtocolError(msg.protocolVersion);
          return;
        }
        if (msg.type === "hello.ok" && msg.commit) {
          if (!gatewayCommit.current) gatewayCommit.current = msg.commit;
          else if (gatewayCommit.current !== msg.commit) setNewVersion(true);
          return;
        }
        if (msg.type === "config.error") {
          o.onConfigError?.(msg.message);
          return;
        }
        if (msg.type === "threads.snapshot") {
          setThreads(msg.threads);
          setCurrentThreadId(msg.currentId);
        }
        if (msg.type === "transcript.snapshot") {
          snapshotCount.current += 1;
          batcher.drop();
          snapshotReadyRef.current = true;
          setSnapshotReady(true);
          setTranscriptTruncated(Boolean(msg.truncated));
          setBlocks(replay(msg.events));
          lastSeq = msg.lastSeq ?? 0;
          return;
        }
        if (msg.type === "session") {
          setBusy(msg.busy);
          if (!msg.busy) {
            setQueued(false);
            setRunStartedAt(undefined);
          } else if (msg.runStartedAt) {
            setRunStartedAt(msg.runStartedAt);
          }
          if (msg.threadId) setCurrentThreadId(msg.threadId);
        }
        if (msg.type === "queue.snapshot") {
          setQueueItems(msg.items);
          setQueued(msg.items.length > 0);
        }
        if (msg.type === "config") {
          o.onConfigError?.("");
          o.onConfig(msg.config);
          keepaliveRef.current(msg.config.network.wsKeepaliveSeconds);
        }
        if (msg.type === "run.queued") setQueued(true);
        if (msg.type === "run.start") setQueued(false);
        if ((msg.type === "user.message" || msg.type === "user.retracted") && msg.id) o.onEcho?.(msg.id);
        /* A refusal comes back to this socket alone, unnumbered. */
        if (msg.type === "run.error" && msg.phase === "startup" && msg.seq === undefined) o.onRefusal?.(msg.message);
        if (isTranscriptEvent(msg)) {
          if (!snapshotReadyRef.current) return;
          if (typeof msg.seq === "number") {
            if (msg.seq <= lastSeq) return;
            lastSeq = msg.seq;
          }
          batcher.push(msg);
        }
      },
    });
    sendRef.current = sock.send;
    keepaliveRef.current = sock.setKeepalive;
    return () => {
      batcher.drop();
      sock.close();
    };
  }, []);

  useEffect(() => {
    keepaliveRef.current(opts.keepaliveSeconds);
  }, [opts.keepaliveSeconds]);

  const send = useCallback((msg: ClientMessage) => sendRef.current(msg), []);

  /**
   * Clear the transcript for a thread change requested over HTTP; the gateway's snapshot fills it.
   * Returns a mark for rollbackTranscript.
   */
  const beginTranscriptSwap = useCallback((): number => {
    snapshotReadyRef.current = false;
    setSnapshotReady(false);
    setBlocks([]);
    return snapshotCount.current;
  }, []);

  /*
   * The request failed, but the gateway may still have switched (a timeout after the work was
   * done) and sent its snapshot. Only put the old blocks back when it did not.
   */
  const rollbackTranscript = useCallback((prevBlocks: Block[], mark: number) => {
    snapshotReadyRef.current = true;
    setSnapshotReady(true);
    if (snapshotCount.current === mark) setBlocks(prevBlocks);
  }, []);

  return {
    conn,
    protocolError,
    newVersion,
    blocks,
    snapshotReady,
    transcriptTruncated,
    busy,
    runStartedAt,
    queued,
    queueItems,
    threads,
    setThreads,
    currentThreadId,
    setCurrentThreadId,
    send,
    beginTranscriptSwap,
    rollbackTranscript,
  };
}
