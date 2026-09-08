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
import { ThreadDrawer } from "../components/ThreadDrawer";
import { operatorError, shouldSubmitOnEnter } from "../operatorError";
import { blockMatchesQuery, cwdBasename, isImageMime, slashQuery } from "../format";
import { loadDraft, saveDraft } from "../draftStorage";
import { CommandPalette, templatePaletteItems, type PaletteItem } from "../components/CommandPalette";

const COMPOSER_MAX_PX = 160;

export { shouldSubmitOnEnter };

function overlayState(): { glassysOverlay?: string } | null {
  const st = history.state;
  if (st && typeof st === "object" && "glassysOverlay" in st) return st as { glassysOverlay?: string };
  return null;
}

function pushOverlay(kind: "threads" | "settings") {
  if (overlayState()) history.replaceState({ glassysOverlay: kind }, "");
  else history.pushState({ glassysOverlay: kind }, "");
}

function popOverlay() {
  if (overlayState()) history.back();
}

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
  const [adaptersError, setAdaptersError] = useState("");
  const [hostLabel, setHostLabel] = useState("");
  const [loopback, setLoopback] = useState(false);
  const [git, setGit] = useState<{ branch: string; dirty: boolean } | undefined>();
  const [hostCopied, setHostCopied] = useState(false);
  const [snapshotReady, setSnapshotReady] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [search, setSearch] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [slashOpen, setSlashOpen] = useState(false);
  const [pins, setPins] = useState<string[]>([]);
  const [recents, setRecents] = useState<string[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const [restartNote, setRestartNote] = useState("");
  const sendRef = useRef<(msg: ClientMessage) => boolean>(() => false);
  const keepaliveRef = useRef<(seconds: number) => void>(() => undefined);
  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const threadBtn = useRef<HTMLButtonElement>(null);
  const pinToBottom = useRef(true);
  const settingsBtn = useRef<HTMLButtonElement>(null);
  const loadedDraftFor = useRef<string | null>(null);
  const closeSettings = useCallback(() => {
    setSettings(false);
    popOverlay();
    queueMicrotask(() => settingsBtn.current?.focus());
  }, []);
  const closeThreads = useCallback(() => {
    setThreadOpen(false);
    popOverlay();
    queueMicrotask(() => threadBtn.current?.focus());
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
        if (s === "connected") setRestartNote("");
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
          setConfigError(operatorError(msg.message, t));
          return;
        }
        if (msg.type === "threads.snapshot") {
          setThreads(msg.threads);
          setCurrentThreadId(msg.currentId);
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

  const loadAdapters = useCallback(() => {
    setAdaptersError("");
    api
      .adapters()
      .then((r) => setAdapters(r.adapters))
      .catch((err) => {
        setAdapters([]);
        setAdaptersError(err instanceof Error ? err.message : t("wizard.adapters.failed"));
      });
  }, [t]);

  useEffect(() => {
    void loadModels();
    loadAdapters();
    api.threads().then((r) => {
      setThreads(r.threads);
      setCurrentThreadId(r.currentId);
    }).catch(() => undefined);
    api
      .reachability()
      .then((r) => {
        const parts = [r.user, r.hostname].filter((p): p is string => Boolean(p && p.trim()));
        setHostLabel(parts.join("@"));
        setLoopback(r.loopback);
        setGit(r.git);
      })
      .catch(() => undefined);
    api
      .workspaces()
      .then((r) => {
        setRecents(r.recents || []);
        setPins(r.pins || []);
      })
      .catch(() => undefined);
  }, [loadModels, loadAdapters, config.agent.adapter, config.agent.cwd]);

  useEffect(() => {
    if (loadedDraftFor.current === currentThreadId) return;
    const prev = loadedDraftFor.current;
    if (prev) saveDraft(prev, text, drafts);
    const orphan = prev === null && Boolean(text.trim() || drafts.length);
    loadedDraftFor.current = currentThreadId;
    if (!currentThreadId) return;
    if (orphan) {
      saveDraft(currentThreadId, text, drafts);
      return;
    }
    const loaded = loadDraft(currentThreadId);
    setText(loaded.text);
    setDrafts(loaded.attachments);
  }, [currentThreadId]);

  useEffect(() => {
    if (loadedDraftFor.current !== currentThreadId) return;
    saveDraft(currentThreadId, text, drafts);
  }, [currentThreadId, text, drafts]);

  useEffect(() => {
    const name = config.space.name.trim() || "Glassys";
    const th = threads.find((item) => item.id === currentThreadId);
    document.title = th?.title ? `${th.title} · ${name}` : name;
    return () => {
      document.title = name;
    };
  }, [config.space.name, threads, currentThreadId]);

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
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSlashOpen(false);
        setPaletteQuery("");
        setPaletteOpen((v) => !v);
        return;
      }
      if (e.key !== "Escape") return;
      if (paletteOpen || slashOpen) {
        setPaletteOpen(false);
        setSlashOpen(false);
        return;
      }
      if (settings) return;
      if (threadOpen) closeThreads();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settings, threadOpen, closeThreads, paletteOpen, slashOpen]);

  useEffect(() => {
    function onPop() {
      setSettings(false);
      setThreadOpen(false);
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  const waiting = queueItems.length > 0 || queued;
  const liveUsage = (() => {
    const meta = threads.find((th) => th.id === currentThreadId)?.usage;
    if (meta && (meta.inputTokens || meta.outputTokens)) return meta;
    let inputTokens = 0;
    let outputTokens = 0;
    for (const b of blocks) {
      if (b.kind === "usage") {
        inputTokens += b.inputTokens || 0;
        outputTokens += b.outputTokens || 0;
      }
    }
    if (!inputTokens && !outputTokens) return null;
    return { inputTokens, outputTokens };
  })();
  const visibleBlocks = search.trim() ? blocks.filter((b) => blockMatchesQuery(b, search)) : blocks;
  const canSend = Boolean(text.trim() || drafts.length) && conn === "connected" && snapshotReady && protocolError === null;
  const queuedIds = new Set(queueItems.map((item) => item.id));
  const lastTool = [...blocks].reverse().find((b) => b.kind === "tool" && b.status === "running");
  const elapsed = busy && runStartedAt ? formatElapsed(now - runStartedAt) : "";

  const statusClass =
    protocolError || conn === "error"
      ? "error"
      : busy
        ? "running"
        : waiting
          ? "queued"
          : conn;

  function applyThreadList(r: { threads: ThreadSummary[]; currentId: string | null }) {
    setThreads(r.threads);
    setCurrentThreadId(r.currentId);
  }

  function beginThreadChange() {
    snapshotReadyRef.current = false;
    setSnapshotReady(false);
    setBlocks([]);
  }

  async function onNewThread() {
    if (busy || waiting) {
      setSendError(t("threads.busy"));
      return;
    }
    const prevBlocks = blocks;
    try {
      beginThreadChange();
      applyThreadList(await api.newThread());
      closeThreads();
      setSendError("");
    } catch (err) {
      snapshotReadyRef.current = true;
      setSnapshotReady(true);
      setBlocks(prevBlocks);
      setSendError(operatorError(err instanceof Error ? err.message : "busy", t));
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
      setSendError(operatorError(err instanceof Error ? err.message : "busy", t));
    }
  }

  async function onSwitchThread(id: string) {
    if (id === currentThreadId) {
      closeThreads();
      return;
    }
    if (busy || waiting) {
      setSendError(t("threads.busy"));
      return;
    }
    const prevBlocks = blocks;
    try {
      beginThreadChange();
      applyThreadList(await api.switchThread(id));
      closeThreads();
      setSendError("");
    } catch (err) {
      snapshotReadyRef.current = true;
      setSnapshotReady(true);
      setBlocks(prevBlocks);
      setSendError(operatorError(err instanceof Error ? err.message : "busy", t));
    }
  }

  async function onRenameThread(id: string, title: string) {
    try {
      applyThreadList(await api.renameThread(id, title));
    } catch (err) {
      setSendError(operatorError(err instanceof Error ? err.message : t("chat.modelFailed"), t));
    }
  }

  async function onExport() {
    if (!currentThreadId) return;
    try {
      const file = await api.exportThread(currentThreadId);
      const shareFile = new File([file.blob], file.name, { type: "text/markdown" });
      const nav = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
        share?: (data: ShareData) => Promise<void>;
      };
      try {
        if (typeof nav.share === "function" && nav.canShare?.({ files: [shareFile] })) {
          await nav.share({ files: [shareFile], title: file.name });
          return;
        }
      } catch {
        /* fall through to download */
      }
      const url = URL.createObjectURL(file.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setSendError(operatorError(err instanceof Error ? err.message : t("chat.sendFailed"), t));
    }
  }

  async function onRestart() {
    try {
      setRestartNote(t("settings.restarting"));
      await api.restart();
    } catch (err) {
      setRestartNote(operatorError(err instanceof Error ? err.message : t("settings.restartFailed"), t));
    }
  }

  async function refreshSites() {
    try {
      const r = await api.workspaces();
      setRecents(r.recents || []);
      setPins(r.pins || []);
    } catch {
      /* ignore */
    }
  }

  async function onOpenCwd(cwd: string) {
    if (cwd === config.agent.cwd) {
      closeThreads();
      return;
    }
    if (busy || waiting) {
      setSendError(t("threads.busy"));
      return;
    }
    const hasThread = threads.some((th) => th.cwd === cwd);
    if (!hasThread && !window.confirm(t("settings.archiveConfirm"))) return;
    const prevBlocks = blocks;
    try {
      beginThreadChange();
      const r = await api.openWorkspace(cwd);
      applyThreadList(r);
      onConfig(r.config);
      closeThreads();
      setSendError("");
      await refreshSites();
    } catch (err) {
      snapshotReadyRef.current = true;
      setSnapshotReady(true);
      setBlocks(prevBlocks);
      setSendError(operatorError(err instanceof Error ? err.message : "busy", t));
    }
  }

  async function onPin(cwd: string) {
    try {
      const next = Array.from(new Set([...pins, cwd]));
      setPins((await api.pinWorkspaces(next)).pins);
    } catch (err) {
      setSendError(operatorError(err instanceof Error ? err.message : t("chat.modelFailed"), t));
    }
  }

  async function onUnpin(cwd: string) {
    try {
      setPins((await api.pinWorkspaces(pins.filter((p) => p !== cwd))).pins);
    } catch (err) {
      setSendError(operatorError(err instanceof Error ? err.message : t("chat.modelFailed"), t));
    }
  }

  function insertTemplate(body: string) {
    setText(body);
    setSlashOpen(false);
    setPaletteOpen(false);
    queueMicrotask(() => {
      if (composer.current) {
        composer.current.value = body;
        resizeComposer(composer.current);
        composer.current.focus();
      }
    });
  }

  const paletteItems: PaletteItem[] = [
    { id: "new", group: "product", label: t("palette.newThread"), run: () => void onNewThread() },
    { id: "cancel", group: "product", label: t("palette.cancel"), run: () => { sendRef.current({ type: "run.cancel" }); } },
    { id: "export", group: "product", label: t("palette.export"), run: () => void onExport() },
    {
      id: "settings",
      group: "product",
      label: t("palette.settings"),
      run: () => {
        pushOverlay("settings");
        setSettings(true);
      },
    },
    {
      id: "search",
      group: "product",
      label: t("palette.search"),
      run: () => searchRef.current?.focus(),
    },
    { id: "restart", group: "product", label: t("palette.restart"), run: () => void onRestart() },
    {
      id: "upgrade",
      group: "product",
      label: t("palette.upgrade"),
      run: () => {
        void api.upgrade().catch((err) => {
          setSendError(operatorError(err instanceof Error ? err.message : t("settings.updateFailed"), t));
        });
      },
    },
    {
      id: "schedule",
      group: "product",
      label: t("palette.schedule"),
      run: () => {
        const body = text.trim();
        if (!body) return;
        void api
          .createSchedule({
            text: body,
            cwd: config.agent.cwd,
            threadId: currentThreadId || undefined,
            at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          })
          .then(() => {
            pushOverlay("settings");
            setSettings(true);
          })
          .catch((err) => {
            setSendError(operatorError(err instanceof Error ? err.message : t("chat.sendFailed"), t));
          });
      },
    },
    ...pins.concat(recents.filter((c) => !pins.includes(c))).map((cwd) => ({
      id: `cwd:${cwd}`,
      group: "product" as const,
      label: cwdBasename(cwd),
      hint: cwd,
      run: () => void onOpenCwd(cwd),
    })),
    ...templatePaletteItems(config.prompts?.templates ?? [], t, insertTemplate),
  ];

  async function onAttach(files: FileList | File[] | null) {
    if (!files || !files.length) return;
    setAttachError("");
    try {
      for (const file of Array.from(files)) {
        const att = await api.upload(file);
        setDrafts((cur) => [...cur, att]);
      }
    } catch (err) {
      setAttachError(operatorError(err instanceof Error ? err.message : t("chat.attachFailed"), t));
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
      setModelError(operatorError(err instanceof Error ? err.message : t("chat.modelFailed"), t));
    }
  }

  const statusKey = protocolError
    ? "status.error"
    : busy && waiting
      ? "status.runningQueued"
      : busy
        ? "status.running"
        : waiting
          ? "status.queued"
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
              <strong>{config.space.name.trim() || t("app.name")}</strong>
              <span className="host-context muted">
                <button
                  type="button"
                  className="host-copy"
                  title={config.agent.cwd}
                  aria-label={t("chat.copyCwd")}
                  onClick={() => {
                    const value = config.agent.cwd;
                    if (!value) return;
                    void navigator.clipboard.writeText(value).then(
                      () => {
                        setHostCopied(true);
                        setTimeout(() => setHostCopied(false), 1500);
                      },
                      () => setSendError(t("chat.copyFailed")),
                    );
                  }}
                >
                  {[
                    hostLabel,
                    config.agent.cwd || cwdBasename(config.agent.cwd),
                    git
                      ? `${git.branch}${git.dirty ? ` (${t("chat.gitDirty")})` : ""}`
                      : "",
                    currentAdapter?.displayName || config.agent.adapter,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  {hostCopied ? ` · ${t("chat.copied")}` : ""}
                </button>
              </span>
              {currentAdapter?.available && !currentAdapter.available.ok && (
                <span className="warn">{t("wizard.adapter.unavailable")}</span>
              )}
              <span className={`status ${statusClass}`} aria-live="polite">
                {t(statusKey)}
              </span>
              {liveUsage && (
                  <span className="muted usage-chip">
                    {t("chat.usageTotal")} ↓{liveUsage.inputTokens} ↑{liveUsage.outputTokens}
                  </span>
                )}
            </div>
          </div>
          <div className="top-actions">
            <button
              ref={threadBtn}
              type="button"
              className="ghost"
              aria-expanded={threadOpen}
              onClick={() => {
                if (threadOpen) closeThreads();
                else {
                  pushOverlay("threads");
                  setThreadOpen(true);
                }
              }}
            >
              {t("nav.threads")}
            </button>
            <button
              ref={settingsBtn}
              type="button"
              className="ghost"
              aria-expanded={settings}
              onClick={() => {
                if (threadOpen) setThreadOpen(false);
                pushOverlay("settings");
                setSettings(true);
              }}
            >
              {t("nav.settings")}
            </button>
          </div>
        </div>
      </header>
      {threadOpen && (
        <ThreadDrawer
          threads={threads}
          currentId={currentThreadId}
          locale={config.space.locale}
          busy={busy}
          waiting={waiting}
          onNew={() => void onNewThread()}
          onSwitch={(id) => void onSwitchThread(id)}
          onDelete={(id, e) => void onDeleteThread(id, e)}
          onRename={onRenameThread}
          onClose={closeThreads}
          git={git}
          currentCwd={config.agent.cwd}
          pins={pins}
          recents={recents}
          onOpenCwd={(cwd) => void onOpenCwd(cwd)}
          onPin={(cwd) => void onPin(cwd)}
          onUnpin={(cwd) => void onUnpin(cwd)}
        />
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
      {loopback && (
        <p className="banner warn" role="status">
          {t("reach.loopback")}
        </p>
      )}
      {adaptersError && (
        <p className="banner error" role="alert">
          {t("chat.adaptersFailed")}{" "}
          <button type="button" className="ghost tiny" onClick={() => loadAdapters()}>
            {t("chat.adaptersRetry")}
          </button>
        </p>
      )}
      {config.restartRequired && (
        <p className="banner warn" role="status">
          {t("settings.restartRequired")}{" "}
          <button type="button" className="ghost tiny" onClick={() => void onRestart()}>
            {t("settings.restart")}
          </button>
          {restartNote ? ` ${restartNote}` : ""}
        </p>
      )}
      {restartNote && !config.restartRequired && (
        <p className="banner info" role="status">
          {restartNote}
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
          const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
          pinToBottom.current = bottom;
          setAtBottom(bottom);
        }}
      >
        <div className="transcript-toolbar">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("chat.search")}
            aria-label={t("chat.search")}
            ref={searchRef}
          />
          <button type="button" className="ghost tiny" onClick={() => void onExport()} disabled={!currentThreadId}>
            {t("chat.export")}
          </button>
        </div>
        <div className="transcript-inner">
        {!snapshotReady && (
          <p className="empty" aria-live="polite">
            {t(conn === "reconnecting" ? "status.reconnecting" : "status.connecting")}
          </p>
        )}
        {blocks.length === 0 && snapshotReady && !search.trim() && <p className="empty">{t("chat.empty")}</p>}
        {search.trim() && visibleBlocks.length === 0 && blocks.length > 0 && (
          <p className="empty">{t("chat.searchEmpty")}</p>
        )}
        {visibleBlocks.map((b) => {
          if (b.kind === "user") {
            const pending = Boolean(b.messageId && queuedIds.has(b.messageId));
            return (
              <div
                key={b.id}
                className={`bubble user${b.retracted ? " retracted" : ""}${pending ? " pending" : ""}`}
              >
                {b.attachments && b.attachments.length > 0 && (
                  <div className="thumbs">
                    {b.attachments.map((a) =>
                      isImageMime(a.mime) ? (
                        <img key={a.id} src={`/api/uploads/${encodeURIComponent(a.id)}`} alt={a.name} />
                      ) : (
                        <span key={a.id} className="file-chip">
                          {a.name}
                        </span>
                      ),
                    )}
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
          if (b.kind === "banner" && b.text === "stalled") {
            return (
              <p key={b.id} className="banner warn" role="status">
                {t("chat.stalled")}
              </p>
            );
          }
          if (b.kind === "banner") {
            return (
              <p key={b.id} className={`banner ${b.tone}`} role={b.tone === "error" ? "alert" : "status"}>
                {operatorError(b.text, t)}
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
        {!atBottom && (
          <button
            type="button"
            className="ghost jump-bottom"
            onClick={() => {
              pinToBottom.current = true;
              setAtBottom(true);
              scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
            }}
          >
            {t("chat.jumpBottom")}
          </button>
        )}
        </div>
      </main>
      <form
        className="composer"
        onSubmit={submit}
        onPaste={(e) => {
          const files = [...(e.clipboardData?.files ?? [])];
          const fromFiles = files.filter((f) => attachableFile(f));
          if (fromFiles.length) {
            e.preventDefault();
            void onAttach(fromFiles);
            return;
          }
          const pasted = e.clipboardData?.getData("text/plain") || "";
          if (pasted.length > 2048) {
            e.preventDefault();
            void onAttach([new File([pasted], "paste.txt", { type: "text/plain" })]);
          }
        }}
        onDragOver={(e) => {
          if ([...e.dataTransfer.types].includes("Files")) e.preventDefault();
        }}
        onDrop={(e) => {
          const files = [...e.dataTransfer.files].filter((f) => attachableFile(f));
          if (!files.length) return;
          e.preventDefault();
          void onAttach(files);
        }}
      >
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
            {caps?.attachments === false && <p className="muted composer-hint">{t("chat.attachPathOnly")}</p>}
            {waiting && <p className="muted composer-hint">{t("chat.queuedHint")}</p>}
            {queueItems.length > 0 && (
              <ul className="queue-list" aria-label={t("chat.queueList")}>
                {queueItems.map((item) => (
                  <li key={item.id}>
                    <span>
                      {item.source === "schedule" ? `${t("chat.queueSchedule")}: ` : ""}
                      {item.text || (item.hasAttachments ? t("chat.pendingAttach") : t("chat.pending"))}
                    </span>
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
                  aria-label={`${t("chat.removeAttach")} ${a.name}`}
                  onClick={() => setDrafts((cur) => cur.filter((d) => d.id !== a.id))}
                >
                  {isImageMime(a.mime) ? (
                    <img src={`/api/uploads/${encodeURIComponent(a.id)}`} alt={a.name} />
                  ) : (
                    <span className="file-chip">{a.name}</span>
                  )}
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
              accept="image/*,.log,.txt,.md,.json,.jsonl,.service,.conf,.journal,text/plain"
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
              enterKeyHint="send"
              onChange={(e) => {
                const next = e.target.value;
                setText(next);
                const q = slashQuery(next);
                setSlashOpen(q !== null);
                if (q !== null) setPaletteQuery(q);
                resizeComposer(e.currentTarget);
              }}
              onKeyDown={(e) => {
                if (slashOpen || paletteOpen) {
                  if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Escape") {
                    e.preventDefault();
                  }
                  return;
                }
                if (shouldSubmitOnEnter(e)) {
                  e.preventDefault();
                  submit(e);
                }
              }}
            />
            {slashOpen && (
              <CommandPalette
                open
                inline
                hideSearch
                query={slashQuery(text) ?? ""}
                items={templatePaletteItems(config.prompts?.templates ?? [], t, insertTemplate)}
                onClose={() => setSlashOpen(false)}
              />
            )}
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
      <CommandPalette
        open={paletteOpen}
        query={paletteQuery}
        items={paletteItems}
        onClose={() => setPaletteOpen(false)}
        onQuery={setPaletteQuery}
      />
    </div>
  );
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

function attachableFile(file: File): boolean {
  if (isImageMime(file.type)) return true;
  if (
    file.type === "text/plain" ||
    file.type === "text/markdown" ||
    file.type === "text/x-log" ||
    file.type === "application/json" ||
    file.type === "application/x-ndjson"
  ) {
    return true;
  }
  return /\.(log|txt|md|json|jsonl|service|conf|journal)$/i.test(file.name);
}
