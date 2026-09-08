import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type {
  AdapterPublicInfo,
  ClientMessage,
  MessageAttachment,
  ModelCatalogItem,
  ModelListSource,
  ModelParam,
  QueueItem,
  RedactedConfig,
  ServerMessage,
  ThreadSummary,
} from "@glassys/protocol";
import { PROTOCOL_VERSION, isTranscriptEvent } from "@glassys/protocol";
import { useT } from "../i18n";
import { api, clearToken } from "../api";
import { openSocket, type ConnState } from "../socket";
import { reduceTranscript, replay, type Block } from "../transcript";
import { MarkdownBody } from "../components/MarkdownBody";
import { Thinking } from "../components/Thinking";
import { ToolCard } from "../components/ToolCard";
import { ModelPicker } from "../components/ModelPicker";
import { PermissionChip } from "../components/PermissionChip";
import { Settings } from "./Settings";

const COMPOSER_MAX_PX = 160;

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return m > 0 ? `${m}:${String(rem).padStart(2, "0")}` : `${s}s`;
}

export function resizeComposer(el: HTMLTextAreaElement, maxPx = COMPOSER_MAX_PX): void {
  if (!el.value) {
    el.style.height = "";
    el.style.overflowY = "";
    return;
  }
  el.style.height = "0px";
  const next = Math.min(el.scrollHeight, maxPx);
  el.style.height = `${next}px`;
  el.style.overflowY = el.scrollHeight > maxPx ? "auto" : "hidden";
}

export function Chat({
  config,
  onConfig,
  onLogout,
}: {
  config: RedactedConfig;
  onConfig: (c: RedactedConfig) => void;
  onLogout: () => void;
}) {
  const t = useT();
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const [threadOpen, setThreadOpen] = useState(false);
  const [runStartedAt, setRunStartedAt] = useState<number | undefined>();
  const [now, setNow] = useState(Date.now());
  const [drafts, setDrafts] = useState<MessageAttachment[]>([]);
  const [attachError, setAttachError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [conn, setConn] = useState<ConnState>("connecting");
  const [protocolError, setProtocolError] = useState<number | null>(null);
  const [configError, setConfigError] = useState("");
  const [sendError, setSendError] = useState("");
  const [modelError, setModelError] = useState("");
  const [text, setText] = useState("");
  const [draftModel, setDraftModel] = useState<{ id: string; params: ModelParam[] } | null>(null);
  const [settings, setSettings] = useState(false);
  const [models, setModels] = useState<ModelCatalogItem[]>([]);
  const [modelSource, setModelSource] = useState<ModelListSource>("live");
  const [catalogError, setCatalogError] = useState("");
  const [adapters, setAdapters] = useState<AdapterPublicInfo[]>([]);
  const [snapshotReady, setSnapshotReady] = useState(false);
  const sendRef = useRef<(msg: ClientMessage) => boolean>(() => false);
  const keepaliveRef = useRef<(seconds: number) => void>(() => undefined);
  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const threadBtn = useRef<HTMLButtonElement>(null);
  const pinToBottom = useRef(true);
  const settingsBtn = useRef<HTMLButtonElement>(null);
  const closeSettings = useCallback(() => {
    setSettings(false);
    queueMicrotask(() => settingsBtn.current?.focus());
  }, []);
  const onLogoutRef = useRef(onLogout);
  onLogoutRef.current = onLogout;

  const snapshotReadyRef = useRef(false);

  const currentAdapter = adapters.find((a) => a.id === config.agent.adapter);
  const caps = currentAdapter?.capabilities;
  const pickerModel = draftModel?.id ?? config.agent.model;
  const pickerParams = draftModel?.params ?? config.agent.modelParams ?? [];

  const loadModels = useCallback(async () => {
    try {
      const r = await api.models();
      setModels(r.models);
      setModelSource(r.source);
      setCatalogError(r.error || "");
    } catch (err) {
      setModels([]);
      setModelSource("fallback");
      setCatalogError(err instanceof Error ? err.message : "");
    }
  }, []);

  useEffect(() => {
    const sock = openSocket({
      onState: (s) => {
        if (s === "connecting" || s === "reconnecting") {
          snapshotReadyRef.current = false;
          setSnapshotReady(false);
        }
        setConn(s);
      },
      onEvent: (msg: ServerMessage) => {
        if (msg.type === "auth.error") {
          clearToken();
          void api.logout().finally(() => onLogoutRef.current());
          return;
        }
        if (msg.type === "hello.incompatible") {
          setProtocolError(msg.protocolVersion);
          return;
        }
        if (msg.type === "config.error") {
          setConfigError(msg.message);
          return;
        }
        if (msg.type === "transcript.snapshot") {
          snapshotReadyRef.current = true;
          setSnapshotReady(true);
          setBlocks(replay(msg.events));
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
          setConfigError("");
          onConfig(msg.config);
          keepaliveRef.current(msg.config.network.wsKeepaliveSeconds);
        }
        if (msg.type === "run.queued") setQueued(true);
        if (msg.type === "run.start") setQueued(false);
        if (isTranscriptEvent(msg)) {
          if (!snapshotReadyRef.current) return;
          setBlocks((cur) => reduceTranscript(cur, msg));
        }
      },
    });
    sendRef.current = sock.send;
    keepaliveRef.current = sock.setKeepalive;
    keepaliveRef.current(config.network.wsKeepaliveSeconds);
    return () => sock.close();
  }, [onConfig]);

  useEffect(() => {
    keepaliveRef.current(config.network.wsKeepaliveSeconds);
  }, [config.network.wsKeepaliveSeconds]);

  useEffect(() => {
    void loadModels();
    api.adapters().then((r) => setAdapters(r.adapters)).catch(() => setAdapters([]));
    api.threads().then((r) => {
      setThreads(r.threads);
      setCurrentThreadId(r.currentId);
    }).catch(() => undefined);
  }, [loadModels, config.agent.adapter, config.agent.cwd]);

  useEffect(() => {
    if (!draftModel) return;
    const savedParams = config.agent.modelParams ?? [];
    if (draftModel.id === config.agent.model && JSON.stringify(draftModel.params) === JSON.stringify(savedParams)) {
      setDraftModel(null);
    }
  }, [config.agent.model, config.agent.modelParams, draftModel]);

  useEffect(() => {
    if (!pinToBottom.current) return;
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [blocks, busy]);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => {
      document.documentElement.style.setProperty("--vv-height", `${Math.round(vv.height)}px`);
      document.documentElement.style.setProperty("--vv-offset", `${Math.round(vv.offsetTop)}px`);
    };
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      document.documentElement.style.removeProperty("--vv-height");
      document.documentElement.style.removeProperty("--vv-offset");
    };
  }, []);

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  const waiting = queueItems.length > 0 || queued;
  const canSend = Boolean(text.trim() || drafts.length) && conn === "connected" && snapshotReady && protocolError === null;
  const queuedIds = new Set(queueItems.map((item) => item.id));
  const lastTool = [...blocks].reverse().find((b) => b.kind === "tool" && b.status === "running");
  const elapsed = busy && runStartedAt ? formatElapsed(now - runStartedAt) : "";

  const statusClass =
    protocolError || conn === "error"
      ? "error"
      : waiting
        ? "queued"
        : busy
          ? "running"
          : conn;

  function applyThreadList(r: { threads: ThreadSummary[]; currentId: string | null }) {
    setThreads(r.threads);
    setCurrentThreadId(r.currentId);
  }

  async function onNewThread() {
    try {
      applyThreadList(await api.newThread());
      setThreadOpen(false);
      setSendError("");
    } catch (err) {
      setSendError(err instanceof Error ? err.message : t("threads.busy"));
    }
  }

  async function onDeleteThread(id: string, e: { stopPropagation: () => void }) {
    e.stopPropagation();
    if (busy || waiting) {
      setSendError(t("threads.busy"));
      return;
    }
    if (!window.confirm(t("threads.deleteConfirm"))) return;
    try {
      applyThreadList(await api.deleteThread(id));
      setSendError("");
    } catch (err) {
      setSendError(err instanceof Error ? err.message : t("threads.busy"));
    }
  }

  async function onSwitchThread(id: string) {
    if (id === currentThreadId) {
      setThreadOpen(false);
      return;
    }
    if (busy || waiting) {
      setSendError(t("threads.busy"));
      return;
    }
    try {
      applyThreadList(await api.switchThread(id));
      setThreadOpen(false);
      setSendError("");
    } catch (err) {
      setSendError(err instanceof Error ? err.message : t("threads.busy"));
    }
  }

  async function onAttach(files: FileList | null) {
    if (!files?.length) return;
    setAttachError("");
    try {
      for (const file of Array.from(files)) {
        const att = await api.upload(file);
        setDrafts((cur) => [...cur, att]);
      }
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : t("chat.attachFailed"));
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if ((!value && !drafts.length) || conn !== "connected" || !snapshotReady || protocolError !== null) return;
    if (!sendRef.current({
      type: "user.message",
      text: value,
      id: crypto.randomUUID(),
      attachments: drafts.length ? drafts : undefined,
    })) {
      setSendError(t("chat.sendFailed"));
      return;
    }
    setSendError("");
    setText("");
    setDrafts([]);
    if (composer.current) resizeComposer(composer.current);
  }

  async function changeModel(id: string, params: ModelParam[]) {
    setDraftModel({ id, params });
    try {
      setModelError("");
      onConfig(await api.saveConfig({ agent: { model: id, modelParams: params } }));
    } catch (err) {
      setDraftModel(null);
      setModelError(err instanceof Error ? err.message : t("chat.modelFailed"));
    }
  }

  const statusKey = protocolError
    ? "status.error"
    : waiting
      ? "status.queued"
      : busy
        ? "status.running"
        : conn === "connected"
          ? "status.connected"
          : conn === "reconnecting"
            ? "status.reconnecting"
            : conn === "error"
              ? "status.error"
              : "status.connecting";

  return (
    <div className="chat-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand tight">
            <img src="/icon.svg" alt="" width={28} height={28} />
            <div>
              <strong>{t("app.name")}</strong>
              <span className="host-context muted">
                {[cwdBasename(config.agent.cwd), currentAdapter?.displayName || config.agent.adapter]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <span className={`status ${statusClass}`} aria-live="polite">
                {t(statusKey)}
              </span>
            </div>
          </div>
          <div className="top-actions">
            <button
              ref={threadBtn}
              type="button"
              className="ghost"
              aria-expanded={threadOpen}
              onClick={() => setThreadOpen((v) => !v)}
            >
              {t("nav.threads")}
            </button>
            <button ref={settingsBtn} type="button" className="ghost" onClick={() => setSettings(true)}>
              {t("nav.settings")}
            </button>
          </div>
        </div>
      </header>
      {threadOpen && (
        <div className="thread-drawer" role="dialog" aria-label={t("threads.title")}>
          <button
            type="button"
            className="thread-scrim"
            aria-label={t("settings.close")}
            onClick={() => {
              setThreadOpen(false);
              queueMicrotask(() => threadBtn.current?.focus());
            }}
          />
          <aside className="thread-panel">
            <header>
              <h2>{t("threads.title")}</h2>
              <button type="button" className="primary" onClick={() => void onNewThread()}>
                {t("threads.new")}
              </button>
            </header>
            <p className="muted">{t("threads.switchResume")}</p>
            {threads.length === 0 && <p className="muted">{t("threads.empty")}</p>}
            <ul className="thread-list">
              {threads.map((th) => (
                <li key={th.id} className="thread-row">
                  <button
                    type="button"
                    className={`ghost picker-item${th.id === currentThreadId ? " current" : ""}`}
                    onClick={() => void onSwitchThread(th.id)}
                  >
                    <strong>{th.title}</strong>
                    <span className="muted">
                      {th.id === currentThreadId ? `${t("threads.current")} · ` : ""}
                      {th.adapter} · {th.cwd}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="ghost tiny"
                    aria-label={t("threads.delete")}
                    onClick={(e) => void onDeleteThread(th.id, e)}
                  >
                    {t("threads.delete")}
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      )}
      <main className="chat-main">
        <h1 className="visually-hidden">{t("app.name")}</h1>
      {protocolError !== null && (
        <p className="banner error" role="alert">
          {t("protocol.incompatible")} ({t("protocol.expected")} {PROTOCOL_VERSION}, {t("protocol.got")} {protocolError})
        </p>
      )}
      {configError && (
        <p className="banner error" role="alert">
          {configError}
        </p>
      )}
      {config.restartRequired && (
        <p className="banner warn" role="status">
          {t("settings.restartRequired")}{" "}
          <button type="button" className="ghost tiny" onClick={() => void api.restart()}>
            {t("settings.restart")}
          </button>
        </p>
      )}
      {sendError && (
        <p className="banner error" role="alert">
          {sendError}
        </p>
      )}
      {attachError && (
        <p className="banner error" role="alert">
          {attachError}
        </p>
      )}
      {modelError && (
        <p className="banner error" role="alert">
          {modelError}
        </p>
      )}
      <div
        className="transcript"
        ref={scroller}
        onScroll={() => {
          const el = scroller.current;
          if (!el) return;
          pinToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
        }}
      >
        <div className="transcript-inner">
        {blocks.length === 0 && snapshotReady && <p className="empty">{t("chat.empty")}</p>}
        {blocks.map((b) => {
          if (b.kind === "user") {
            const pending = Boolean(b.messageId && queuedIds.has(b.messageId));
            return (
              <div
                key={b.id}
                className={`bubble user${b.retracted ? " retracted" : ""}${pending ? " pending" : ""}`}
              >
                {b.attachments && b.attachments.length > 0 && (
                  <div className="thumbs">
                    {b.attachments.map((a) => (
                      <img key={a.id} src={`/api/uploads/${encodeURIComponent(a.id)}`} alt={a.name} />
                    ))}
                  </div>
                )}
                {b.text}
                {pending && <span className="muted bubble-flag">{t("chat.pending")}</span>}
                {b.retracted && <span className="muted bubble-flag">{t("chat.retracted")}</span>}
              </div>
            );
          }
          if (b.kind === "thinking") {
            return (
              <Thinking
                key={b.id}
                text={b.text}
                durationMs={b.durationMs}
                defaultOpen={config.display.thinkingDefault === "expanded"}
              />
            );
          }
          if (b.kind === "text") {
            return (
              <div key={b.id} className="bubble assistant">
                <MarkdownBody text={b.text} />
              </div>
            );
          }
          if (b.kind === "tool") {
            return (
              <ToolCard
                key={b.id}
                block={b}
                shellLines={config.display.shellLinesVisible}
                showDiff={config.display.diffPreview}
              />
            );
          }
          if (b.kind === "usage") {
            const parts = [
              b.inputTokens != null ? `↓${b.inputTokens}` : "",
              b.outputTokens != null ? `↑${b.outputTokens}` : "",
            ].filter(Boolean);
            if (!parts.length) return null;
            return (
              <p key={b.id} className="muted usage">
                {t("chat.usage")} {parts.join(" ")}
              </p>
            );
          }
          if (b.kind === "banner" && b.text === "cancelled") {
            return (
              <p key={b.id} className="banner info" role="status">
                {t("status.cancelled")}
              </p>
            );
          }
          if (b.kind === "banner") {
            return (
              <p key={b.id} className={`banner ${b.tone}`} role={b.tone === "error" ? "alert" : "status"}>
                {b.text}
              </p>
            );
          }
          return null;
        })}
        {busy && <div className="pulse" aria-hidden />}
        {busy && (
          <span className="visually-hidden" aria-live="polite">
            {t("status.running")}
          </span>
        )}
        </div>
      </div>
      </main>
      <form className="composer" onSubmit={submit}>
        <div className="composer-inner">
          <div className="composer-meta">
            {caps?.models !== false && (
              <ModelPicker
                compact
                models={models}
                modelId={pickerModel}
                params={pickerParams}
                preferred={caps?.defaultModel}
                onChange={(id, params) => void changeModel(id, params)}
              />
            )}
            {modelSource === "fallback" && caps?.liveCatalog !== false && caps && (
              <p className="warn" title={catalogError || undefined}>
                {t("wizard.model.fallbackShort")}
              </p>
            )}
            <PermissionChip config={config} caps={caps} onConfig={onConfig} />
            {waiting && <p className="muted composer-hint">{t("chat.queuedHint")}</p>}
            {queueItems.length > 0 && (
              <ul className="queue-list" aria-label={t("chat.queueList")}>
                {queueItems.map((item) => (
                  <li key={item.id}>
                    <span>{item.text || (item.hasAttachments ? t("chat.pendingAttach") : t("chat.pending"))}</span>
                    <button
                      type="button"
                      className="ghost tiny"
                      onClick={() => {
                        if (!sendRef.current({ type: "queue.cancel", id: item.id })) setSendError(t("chat.sendFailed"));
                      }}
                    >
                      {t("chat.queueRemove")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {busy && elapsed && (
              <p className="muted live-line">
                {t("chat.elapsed")} {elapsed}
                {lastTool && lastTool.kind === "tool" ? ` · ${t("chat.lastTool")}: ${lastTool.title}` : ""}
              </p>
            )}
          </div>
          {drafts.length > 0 && (
            <div className="thumbs draft-thumbs">
              {drafts.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="thumb-remove"
                  onClick={() => setDrafts((cur) => cur.filter((d) => d.id !== a.id))}
                >
                  <img src={`/api/uploads/${encodeURIComponent(a.id)}`} alt={a.name} />
                </button>
              ))}
            </div>
          )}
          <div className="composer-box">
            <button
              type="button"
              className="ghost composer-attach"
              aria-label={t("chat.attach")}
              onClick={() => fileRef.current?.click()}
            >
              <AttachIcon />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              hidden
              onChange={(e) => void onAttach(e.target.files)}
            />
            <textarea
              ref={composer}
              rows={1}
              value={text}
              placeholder={t("chat.placeholder")}
              aria-label={t("chat.placeholder")}
              onChange={(e) => {
                setText(e.target.value);
                resizeComposer(e.currentTarget);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit(e);
                }
              }}
            />
            {busy && caps?.cancel !== false && (
              <button
                type="button"
                className="danger composer-send"
                aria-label={t("chat.cancel")}
                onClick={() => {
                  if (!sendRef.current({ type: "run.cancel" })) setSendError(t("chat.sendFailed"));
                }}
              >
                <StopIcon />
              </button>
            )}
            <button className="primary composer-send" type="submit" disabled={!canSend} aria-label={t("chat.send")}>
              <SendIcon />
            </button>
          </div>
        </div>
      </form>
      {settings && (
        <Settings config={config} onClose={closeSettings} onConfig={onConfig} onLogout={onLogout} />
      )}
    </div>
  );
}

function cwdBasename(cwd: string): string {
  const trimmed = cwd.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || "";
}

function AttachIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M8 12.5V8.2A4.2 4.2 0 0 1 16.4 8v9.1a3.4 3.4 0 0 1-6.8 0V9.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4 5.5 18h4.2L12 12.5 14.3 18h4.2L12 4z" fill="currentColor" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" />
    </svg>
  );
}
