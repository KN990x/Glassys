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
import { PROTOCOL_VERSION, MAX_ATTACHMENTS, isTranscriptEvent } from "@glassys/protocol";
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
import { blockMatchesQuery, cwdBasename, formatTokens, isImageMime, slashQuery } from "../format";
import { loadDraft, saveDraft } from "../draftStorage";
import { CommandPalette, templatePaletteItems, type PaletteItem } from "../components/CommandPalette";
import { IconAttach, IconSend, IconStop, IconThreads } from "../components/Icon";
import { Sidebar } from "../components/Sidebar";
import { BottomNav, type NavTarget } from "../components/BottomNav";
import { HostContext, type HostInfo } from "../components/HostContext";
import { AlertStack, type Alert } from "../components/AlertStack";
import { DESKTOP_QUERY, useMediaQuery } from "../useMediaQuery";

const COMPOSER_MAX_PX = 160;
const LOOPBACK_DISMISS_KEY = "glassys.hideLoopback";
const OPS_CHIP_IDS = ["status", "disk", "failed-units"] as const;

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

function RunElapsed({ startedAt, lastTool }: { startedAt: number; lastTool?: string }) {
  const t = useT();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <p className="muted live-line">
      {t("chat.elapsed")} {formatElapsed(now - startedAt)}
      {lastTool ? ` · ${t("chat.lastTool")}: ${lastTool}` : ""}
    </p>
  );
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
  const [hideLoopback, setHideLoopback] = useState(() => {
    try {
      return sessionStorage.getItem(LOOPBACK_DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [git, setGit] = useState<{ branch: string; dirty: boolean } | undefined>();
  const [snapshotReady, setSnapshotReady] = useState(false);
  const [transcriptTruncated, setTranscriptTruncated] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [search, setSearch] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [slashOpen, setSlashOpen] = useState(false);
  const [settingsFocus, setSettingsFocus] = useState<"schedules" | "updates" | undefined>();
  const [schedulePrefill, setSchedulePrefill] = useState("");
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
    setSettingsFocus(undefined);
    setSchedulePrefill("");
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
          setTranscriptTruncated(Boolean(msg.truncated));
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
      setSettingsFocus(undefined);
      setSchedulePrefill("");
      setThreadOpen(false);
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

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
  const opsChipSet = new Set<string>(OPS_CHIP_IDS);
  const opsChips = (config.prompts?.templates ?? []).filter((tpl) => {
    return opsChipSet.has(tpl.id) || opsChipSet.has(tpl.slash.replace(/^\//, ""));
  });

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
    if (!window.confirm(t("settings.restartConfirm"))) return;
    try {
      setRestartNote(t("settings.restarting"));
      await api.restart();
    } catch (err) {
      setRestartNote(operatorError(err instanceof Error ? err.message : t("settings.restartFailed"), t));
    }
  }

  function openSettings(section?: "schedules" | "updates", prefill?: string) {
    setSettingsFocus(section);
    if (prefill !== undefined) setSchedulePrefill(prefill);
    pushOverlay("settings");
    setSettings(true);
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
      run: () => openSettings(),
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
      run: () => openSettings("updates"),
    },
    {
      id: "schedule",
      group: "product",
      label: t("palette.schedule"),
      run: () => {
        const body = text.trim();
        if (!body) return;
        openSettings("schedules", body);
      },
    },
    ...pins.concat(recents.filter((c) => !pins.includes(c))).map((cwd) => ({
      id: `cwd:${cwd}`,
      group: "workspace" as const,
      label: cwdBasename(cwd),
      hint: cwd,
      run: () => void onOpenCwd(cwd),
    })),
    ...templatePaletteItems(config.prompts?.templates ?? [], t, insertTemplate),
  ];

  async function onAttach(files: FileList | File[] | null) {
    if (!files || !files.length) return;
    setAttachError("");
    const incoming = Array.from(files);
    const room = Math.max(0, MAX_ATTACHMENTS - drafts.length);
    const list = incoming.slice(0, room);
    if (incoming.length > room) setAttachError(t("error.tooManyAttachments"));
    if (!list.length) {
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    try {
      for (const file of list) {
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


  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const spaceName = config.space.name.trim() || t("app.name");
  const currentThread = threads.find((th) => th.id === currentThreadId);
  const threadTitle = currentThread?.title || t("threads.untitled");
  const hostInfo: HostInfo = {
    hostLabel,
    cwd: config.agent.cwd,
    git,
    adapter: currentAdapter?.displayName || config.agent.adapter,
  };
  const onCopyFailed = () => setSendError(t("chat.copyFailed"));

  const threadListProps = {
    threads,
    currentId: currentThreadId,
    locale: config.space.locale,
    busy,
    waiting,
    onSwitch: (id: string) => void onSwitchThread(id),
    onDelete: (id: string, e: { stopPropagation: () => void }) => void onDeleteThread(id, e),
    onRename: onRenameThread,
    git,
    currentCwd: config.agent.cwd,
    pins,
    recents,
    onOpenCwd: (cwd: string) => void onOpenCwd(cwd),
    onPin: (cwd: string) => void onPin(cwd),
    onUnpin: (cwd: string) => void onUnpin(cwd),
  };

  const navTarget: NavTarget = settings ? "settings" : threadOpen ? "threads" : paletteOpen ? "ops" : "chat";

  function openThreads() {
    pushOverlay("threads");
    setThreadOpen(true);
  }

  const alerts: Alert[] = [];
  if (protocolError !== null) {
    alerts.push({
      id: "protocol",
      tone: "error",
      text: `${t("protocol.incompatible")} (${t("protocol.expected")} ${PROTOCOL_VERSION}, ${t("protocol.got")} ${protocolError})`,
    });
  }
  if (configError) alerts.push({ id: "config", tone: "error", text: configError });
  if (loopback && !hideLoopback) {
    alerts.push({
      id: "loopback",
      tone: "warn",
      text: t("reach.loopback"),
      onDismiss: () => {
        try {
          sessionStorage.setItem(LOOPBACK_DISMISS_KEY, "1");
        } catch {
          /* private mode */
        }
        setHideLoopback(true);
      },
    });
  }
  if (adaptersError) {
    alerts.push({
      id: "adapters",
      tone: "error",
      text: t("chat.adaptersFailed"),
      action: { label: t("chat.adaptersRetry"), run: () => loadAdapters() },
    });
  }
  if (config.restartRequired) {
    alerts.push({
      id: "restart",
      tone: "warn",
      text: restartNote ? `${t("settings.restartRequired")} ${restartNote}` : t("settings.restartRequired"),
      action: { label: t("settings.restart"), run: () => void onRestart() },
    });
  } else if (restartNote) {
    alerts.push({ id: "restart-note", tone: "info", text: restartNote });
  }
  if (sendError) alerts.push({ id: "send", tone: "error", text: sendError, onDismiss: () => setSendError("") });
  if (attachError) alerts.push({ id: "attach", tone: "error", text: attachError, onDismiss: () => setAttachError("") });
  if (modelError) alerts.push({ id: "model", tone: "error", text: modelError, onDismiss: () => setModelError("") });

  return (
    <div className={`app-shell${isDesktop ? " has-rail" : ""}`}>
      {isDesktop && (
        <Sidebar
          spaceName={spaceName}
          statusClass={statusClass}
          statusLabel={t(statusKey)}
          host={hostInfo}
          threads={threadListProps}
          settingsRef={settingsBtn}
          onNew={() => void onNewThread()}
          onSettings={() => openSettings()}
          onExport={() => void onExport()}
          canExport={Boolean(currentThreadId)}
          onCopyFailed={onCopyFailed}
        />
      )}
      <div className="chat-shell">
        <header className="topbar">
          <div className="topbar-inner">
            {!isDesktop && (
              <button
                ref={threadBtn}
                type="button"
                className="icon-btn"
                aria-expanded={threadOpen}
                aria-label={t("nav.threads")}
                onClick={() => (threadOpen ? closeThreads() : openThreads())}
              >
                <IconThreads size={18} />
              </button>
            )}
            <div className="topbar-title">
              <strong className="truncate">{isDesktop ? threadTitle : spaceName}</strong>
              {!isDesktop && <HostContext info={hostInfo} variant="inline" onCopyFailed={onCopyFailed} />}
              {isDesktop && (
                <span className="host-context muted truncate" title={config.agent.cwd}>
                  {cwdBasename(config.agent.cwd)}
                </span>
              )}
            </div>
            <div className="top-actions">
              {isDesktop && liveUsage && (
                <span className="muted usage-chip" title={t("chat.usageTotal")}>
                  ↓{formatTokens(liveUsage.inputTokens, config.space.locale)} ↑
                  {formatTokens(liveUsage.outputTokens, config.space.locale)}
                </span>
              )}
              {!isDesktop && (
                /* The phone topbar has no room for a status word; the dot carries it. */
                <span className={`status dot-only ${statusClass}`} aria-live="polite" title={t(statusKey)}>
                  <span className="visually-hidden">{t(statusKey)}</span>
                </span>
              )}
            </div>
          </div>
        </header>
        <main className="chat-main">
          <h1 className="visually-hidden">{t("app.name")}</h1>
          <AlertStack alerts={alerts} />
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
        {transcriptTruncated && (
          <p className="banner warn" role="status">
            {t("chat.transcriptTruncated")}{" "}
            <button type="button" className="ghost tiny" onClick={() => void onExport()} disabled={!currentThreadId}>
              {t("chat.export")}
            </button>
          </p>
        )}
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
            {busy && runStartedAt && (
              <RunElapsed startedAt={runStartedAt} lastTool={lastTool && lastTool.kind === "tool" ? lastTool.title : undefined} />
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
          {snapshotReady && !text.trim() && !slashOpen && opsChips.length > 0 && (
            <div className="ops-chips" role="group" aria-label={t("chat.opsChips")}>
              {opsChips.map((tpl) => {
                const slash = tpl.slash.replace(/^\//, "");
                const label = t(`prompt.${tpl.id}`);
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    className="ghost tiny"
                    aria-label={label !== `prompt.${tpl.id}` ? label : tpl.title}
                    onClick={() => insertTemplate(tpl.text)}
                  >
                    /{slash}
                  </button>
                );
              })}
            </div>
          )}
          <div className="composer-box">
            <button
              type="button"
              className="ghost composer-attach"
              aria-label={t("chat.attach")}
              onClick={() => fileRef.current?.click()}
            >
              <IconAttach />
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
                <IconStop fill="currentColor" />
              </button>
            )}
            <button className="primary composer-send" type="submit" disabled={!canSend} aria-label={t("chat.send")}>
              <IconSend />
            </button>
          </div>
          <p className="muted composer-hint">{t("palette.hint")}</p>
        </div>
      </form>
      </div>
      {!isDesktop && (
        <BottomNav
          active={navTarget}
          onSelect={(target: NavTarget) => {
            if (target === "threads") {
              if (threadOpen) closeThreads();
              else openThreads();
              return;
            }
            if (target === "settings") {
              if (threadOpen) setThreadOpen(false);
              openSettings();
              return;
            }
            if (target === "ops") {
              setSlashOpen(false);
              setPaletteQuery("");
              setPaletteOpen(true);
              return;
            }
            if (threadOpen) closeThreads();
            if (settings) closeSettings();
            composer.current?.focus();
          }}
        />
      )}
      {threadOpen && !isDesktop && (
        <ThreadDrawer
          {...threadListProps}
          onNew={() => void onNewThread()}
          onClose={closeThreads}
          onExport={() => void onExport()}
        />
      )}
      {settings && (
        <Settings
          config={config}
          onClose={closeSettings}
          onConfig={onConfig}
          onLogout={onLogout}
          currentThreadId={currentThreadId}
          focusSection={settingsFocus}
          schedulePrefill={schedulePrefill}
        />
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
