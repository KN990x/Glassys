import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type {
  AdapterPublicInfo,
  ClientMessage,
  HostCapabilities,
  MessageAttachment,
  ModelCatalogItem,
  ModelListSource,
  ModelParam,
  QueueItem,
  RedactedConfig,
  ServerMessage,
  Theme,
  ThreadSummary,
} from "@glassys/protocol";
import { PROTOCOL_VERSION, MAX_ATTACHMENTS, isTranscriptEvent } from "@glassys/protocol";
import { useT } from "../i18n";
import { api, clearToken } from "../api";
import { openSocket, type ConnState } from "../socket";
import { reduceTranscript, replay, type Block } from "../transcript";
import { Composer } from "../components/Composer";
import { Settings } from "./Settings";
import { ThreadDrawer } from "../components/ThreadDrawer";
import { operatorError, shouldSubmitOnEnter } from "../operatorError";
import { blockMatchesQuery, formatElapsed, slashQuery } from "../format";
import { loadDraft, saveDraft } from "../draftStorage";
import { CommandPalette } from "../components/CommandPalette";
import { buildPaletteItems } from "./chatPalette";
import { ActivityPanel } from "../components/ActivityPanel";
import { HostViews, type HostViewId } from "./host/HostViews";
import { type AppView } from "../components/ViewTabs";
import { Topbar } from "../components/Topbar";
import { Sidebar } from "../components/Sidebar";
import { BottomNav, type NavTarget } from "../components/BottomNav";
import { type HostInfo } from "../components/HostContext";
import { type Alert } from "../components/AlertStack";
import { AppShell } from "../components/AppShell";
import { ChatMain } from "../components/ChatMain";
import { RunStatus } from "../components/RunStatus";
import { useConfirm } from "../components/ConfirmDialog";
import { DESKTOP_QUERY, useMediaQuery } from "../useMediaQuery";

const COMPOSER_MAX_PX = 160;
const LOOPBACK_DISMISS_KEY = "glassys.hideLoopback";
const RAIL_KEY = "glassys.railCollapsed";
const ACTIVITY_KEY = "glassys.activityOpen";
const INSPECTOR_QUERY = "(min-width: 1280px)";
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
  const { confirm, confirmDialog } = useConfirm();
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(() => {
    try {
      return localStorage.getItem(RAIL_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [activityOpen, setActivityOpen] = useState(() => {
    try {
      return localStorage.getItem(ACTIVITY_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  /* The chat, or one of the host views beside it. The phone's Host tab goes
     back to whichever of overview, services and logs was open last. */
  const [view, setView] = useState<AppView>("chat");
  const [lastHostView, setLastHostView] = useState<Exclude<HostViewId, "files">>("overview");
  const [hostCaps, setHostCaps] = useState<HostCapabilities | null>(null);
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

  const collapseRail = useCallback((next: boolean) => {
    setRailCollapsed(next);
    try {
      localStorage.setItem(RAIL_KEY, next ? "1" : "0");
    } catch {
      /* private mode */
    }
  }, []);

  useEffect(() => {
    api.hostCapabilities().then(setHostCaps, () => setHostCaps({ overview: true, services: null, logs: null, files: true }));
  }, []);

  const showView = useCallback((next: AppView) => {
    setView(next);
    if (next === "overview" || next === "services" || next === "logs") setLastHostView(next);
  }, []);

  const toggleActivity = useCallback((next: boolean) => {
    setActivityOpen(next);
    try {
      localStorage.setItem(ACTIVITY_KEY, next ? "1" : "0");
    } catch {
      /* private mode */
    }
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i") {
        e.preventDefault();
        toggleActivity(!activityOpen);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        collapseRail(!railCollapsed);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(true);
        queueMicrotask(() => searchRef.current?.focus());
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void onNewThread();
        return;
      }
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
      if (searchOpen) {
        setSearchOpen(false);
        setSearch("");
        return;
      }
      /* Escape is the shortcut the run strip advertises. */
      if (busy && !settings && !threadOpen && caps?.cancel !== false) {
        cancelRun();
        return;
      }
      if (settings) return;
      if (threadOpen) closeThreads();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    settings,
    threadOpen,
    closeThreads,
    paletteOpen,
    slashOpen,
    searchOpen,
    railCollapsed,
    collapseRail,
    busy,
    caps,
    activityOpen,
    toggleActivity,
  ]);

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
    if (!(await confirm({ title: t("confirm.titleDelete"), message: t("threads.deleteConfirm"), confirmLabel: t("confirm.delete"), destructive: true })))
      return;
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
    if (!(await confirm({ title: t("confirm.titleRestart"), message: t("settings.restartConfirm"), confirmLabel: t("confirm.restart"), destructive: true })))
      return;
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
    if (!hasThread && !(await confirm({ title: t("confirm.titleArchive"), message: t("settings.archiveConfirm"), confirmLabel: t("confirm.archive"), kind: "archive" })))
      return;
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

  /** A host view's action: back to the chat with the prompt in the composer. */
  function draftPrompt(body: string) {
    showView("chat");
    setText(body);
    setSlashOpen(false);
    requestAnimationFrame(() => {
      if (!composer.current) return;
      resizeComposer(composer.current);
      composer.current.focus();
      composer.current.setSelectionRange(body.length, body.length);
    });
  }

  /** Mention a path: appended to whatever the operator already wrote. */
  function mentionInComposer(snippet: string) {
    const next = text.trim() ? `${text.replace(/\s+$/, "")} ${snippet} ` : `${snippet} `;
    draftPrompt(next);
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

  const paletteItems = buildPaletteItems({
    t,
    theme: config.space.theme,
    railCollapsed,
    activityOpen,
    draft: text,
    threads,
    currentThreadId,
    workspaces: pins.concat(recents.filter((c) => !pins.includes(c))),
    templates: config.prompts?.templates ?? [],
    actions: {
      newThread: () => void onNewThread(),
      cancel: cancelRun,
      exportThread: () => void onExport(),
      openSettings,
      toggleActivity,
      collapseRail,
      changeTheme: (next) => void changeTheme(next),
      openSearch: () => {
        showView("chat");
        setSearchOpen(true);
        queueMicrotask(() => searchRef.current?.focus());
      },
      restart: () => void onRestart(),
      switchThread: (id) => void onSwitchThread(id),
      openCwd: (cwd) => void onOpenCwd(cwd),
      insertTemplate,
      showView,
    },
  });

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

  function cancelRun() {
    if (!sendRef.current({ type: "run.cancel" })) setSendError(t("chat.sendFailed"));
  }

  async function changeTheme(next: Theme) {
    try {
      onConfig(await api.saveConfig({ space: { theme: next } }));
    } catch (err) {
      setSendError(operatorError(err instanceof Error ? err.message : t("chat.modelFailed"), t));
    }
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
  const hasInspectorColumn = useMediaQuery(INSPECTOR_QUERY);
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
    currentAdapter: config.agent.adapter,
    adapterNames: Object.fromEntries(adapters.map((a) => [a.id, a.displayName])),
    pins,
    recents,
    onOpenCwd: (cwd: string) => void onOpenCwd(cwd),
    onPin: (cwd: string) => void onPin(cwd),
    onUnpin: (cwd: string) => void onUnpin(cwd),
  };

  const navTarget: NavTarget = settings
    ? "settings"
    : threadOpen
      ? "threads"
      : view === "files"
        ? "files"
        : view !== "chat"
          ? "host"
          : "chat";

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

  function navigate(target: NavTarget) {
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
    if (threadOpen) closeThreads();
    if (settings) closeSettings();
    if (target === "host") return showView(lastHostView);
    if (target === "files") return showView("files");
    showView("chat");
    requestAnimationFrame(() => composer.current?.focus());
  }

  const notices: Alert[] = transcriptTruncated
    ? [
        {
          id: "truncated",
          tone: "warn",
          text: t("chat.transcriptTruncated"),
          action: { label: t("chat.export"), run: () => void onExport() },
        },
      ]
    : [];

  return (
    <AppShell
      railMode={isDesktop ? (railCollapsed ? "mini" : "full") : "none"}
      rail={
        isDesktop ? (
          <Sidebar
            spaceName={spaceName}
            statusClass={statusClass}
            statusLabel={t(statusKey)}
            host={hostInfo}
            threads={threadListProps}
            settingsRef={settingsBtn}
            onNew={() => void onNewThread()}
            onSearch={() => {
              setSlashOpen(false);
              setPaletteQuery("");
              setPaletteOpen(true);
            }}
            onSettings={() => openSettings()}
            onCopyFailed={onCopyFailed}
            collapsed={railCollapsed}
            onCollapse={collapseRail}
            theme={config.space.theme}
            onTheme={(next) => void changeTheme(next)}
          />
        ) : null
      }
      topbar={
        <Topbar
          view={view}
          onView={showView}
          caps={hostCaps}
          isDesktop={isDesktop}
          statusClass={statusClass}
          statusLabel={t(statusKey)}
          hostLabel={hostLabel}
          hostInfo={hostInfo}
          onCopyFailed={onCopyFailed}
          threadId={currentThreadId}
          threadTitle={{ shown: threadTitle, stored: currentThread?.title || "" }}
          onRename={(id, title) => void onRenameThread(id, title)}
          onExport={() => void onExport()}
          onDelete={(id) => void onDeleteThread(id, { stopPropagation: () => undefined })}
          search={{
            open: searchOpen,
            value: search,
            onChange: setSearch,
            onOpen: () => {
              setSearchOpen(true);
              queueMicrotask(() => searchRef.current?.focus());
            },
            onClose: () => {
              setSearchOpen(false);
              setSearch("");
            },
            inputRef: searchRef,
            count: `${visibleBlocks.length}/${blocks.length}`,
          }}
          activityOpen={activityOpen}
          onActivity={toggleActivity}
        />
      }
      inspector={
        activityOpen && view === "chat" ? (
          <ActivityPanel
            blocks={blocks}
            locale={config.space.locale}
            onClose={() => toggleActivity(false)}
            duration={runStartedAt ? formatElapsed(Date.now() - runStartedAt) : undefined}
            usage={liveUsage}
          />
        ) : null
      }
      inspectorAsColumn={hasInspectorColumn}
      onCloseInspector={() => toggleActivity(false)}
      bottomNav={!isDesktop ? <BottomNav active={navTarget} onSelect={navigate} /> : null}
      overlays={
        <>
          {threadOpen && !isDesktop && (
            <ThreadDrawer {...threadListProps} onNew={() => void onNewThread()} onClose={closeThreads} />
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
          {confirmDialog}
        </>
      }
    >
      {view !== "chat" ? (
        <HostViews
          view={view}
          onView={showView}
          caps={hostCaps}
          locale={config.space.locale}
          cwd={config.agent.cwd}
          narrow={!isDesktop}
          onDraft={draftPrompt}
          onMention={mentionInComposer}
        />
      ) : (
        <>
          <ChatMain
            alerts={alerts}
            notices={notices}
            scrollerRef={scroller}
            onScroll={() => {
              const el = scroller.current;
              if (!el) return;
              const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
              pinToBottom.current = bottom;
              setAtBottom(bottom);
            }}
            atBottom={atBottom}
            onJumpBottom={() => {
              pinToBottom.current = true;
              setAtBottom(true);
              scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
            }}
            transcript={{
              blocks: visibleBlocks,
              allBlocks: blocks,
              snapshotReady,
              connecting: conn !== "reconnecting",
              search,
              queuedIds,
              locale: config.space.locale,
              thinkingDefault: config.display.thinkingDefault,
              shellLines: config.display.shellLinesVisible,
              showDiff: config.display.diffPreview,
              opsChips,
              onTemplate: insertTemplate,
              hostLabel,
              cwd: config.agent.cwd,
              adapterName: currentAdapter?.displayName || config.agent.adapter,
              queue: queueItems,
            }}
          />
          <Composer
            config={config}
            onConfig={onConfig}
            caps={caps}
            adapterName={currentAdapter?.displayName || config.agent.adapter}
            models={models}
            modelId={pickerModel}
            modelParams={pickerParams}
            onModel={(id, params) => void changeModel(id, params)}
            fallbackCatalog={modelSource === "fallback"}
            catalogError={catalogError}
            text={text}
            onText={setText}
            drafts={drafts}
            onRemoveDraft={(id) => setDrafts((cur) => cur.filter((d) => d.id !== id))}
            onAttach={(files) => void onAttach(files)}
            fileRef={fileRef}
            composerRef={composer}
            onSubmit={submit}
            onResize={(el) => resizeComposer(el)}
            canSend={canSend}
            busy={busy}
            waiting={waiting}
            onCancel={cancelRun}
            queue={queueItems}
            onQueueCancel={(id) => {
              if (!sendRef.current({ type: "queue.cancel", id })) setSendError(t("chat.sendFailed"));
            }}
            templates={config.prompts?.templates ?? []}
            onTemplate={insertTemplate}
            slashOpen={slashOpen}
            setSlashOpen={(next) => {
              setSlashOpen(next);
              if (next) setPaletteQuery(slashQuery(text) ?? "");
            }}
            paletteOpen={paletteOpen}
            onPalette={() => {
              setSlashOpen(false);
              setPaletteQuery("");
              setPaletteOpen(true);
            }}
            status={
              busy ? (
                <RunStatus
                  startedAt={runStartedAt}
                  step={lastTool && lastTool.kind === "tool" ? lastTool.title : undefined}
                  canCancel={caps?.cancel !== false}
                />
              ) : null
            }
          />
        </>
      )}
    </AppShell>
  );
}


