import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type {
  AdapterPublicInfo,
  ClientMessage,
  ModelCatalogItem,
  ModelListSource,
  ModelParam,
  RedactedConfig,
  ServerMessage,
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
import { Settings } from "./Settings";

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
          if (!msg.busy) setQueued(false);
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
  }, [loadModels, config.agent.adapter, settings]);

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

  const canSend = Boolean(text.trim()) && conn === "connected" && snapshotReady && protocolError === null;

  const statusClass =
    protocolError || conn === "error"
      ? "error"
      : queued
        ? "queued"
        : busy
          ? "running"
          : conn;

  function submit(e: FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value || conn !== "connected" || !snapshotReady || protocolError !== null) return;
    if (!sendRef.current({ type: "user.message", text: value })) {
      setSendError(t("chat.sendFailed"));
      return;
    }
    setSendError("");
    setText("");
    if (composer.current) composer.current.style.height = "";
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
    : queued
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
              <span className={`status ${statusClass}`} aria-live="polite">
                {t(statusKey)}
              </span>
            </div>
          </div>
          <div className="top-actions">
            <button ref={settingsBtn} type="button" className="ghost" onClick={() => setSettings(true)}>
              {t("nav.settings")}
            </button>
          </div>
        </div>
      </header>
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
      {sendError && (
        <p className="banner error" role="alert">
          {sendError}
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
        {blocks.length === 0 && <p className="empty">{t("chat.empty")}</p>}
        {blocks.map((b) => {
          if (b.kind === "user") {
            return (
              <div key={b.id} className="bubble user">
                {b.text}
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
            {queued && <p className="muted composer-hint">{t("chat.queuedHint")}</p>}
          </div>
          <div className="composer-box">
            <textarea
              ref={composer}
              rows={1}
              value={text}
              placeholder={t("chat.placeholder")}
              aria-label={t("chat.placeholder")}
              onChange={(e) => {
                setText(e.target.value);
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
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
