/**
 * Component gallery. Dev only: Vite builds `index.html` and nothing else, so
 * this never reaches `dist/`. Open it with `pnpm dev` at /gallery.html.
 *
 * It exists so a whole-UI review is one page instead of a throwaway harness
 * rebuilt from memory each time, and so defects that only show up when two
 * components sit side by side — a tool row that ends 38px off, a rail that
 * starts 8px below the topbar — are visible without measuring.
 */
import { useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { I18nProvider } from "./i18n";
import { Sidebar } from "./components/Sidebar";
import { BottomNav } from "./components/BottomNav";
import { AlertStack } from "./components/AlertStack";
import { HostContext } from "./components/HostContext";
import { ToolCard, ToolGroup } from "./components/ToolCard";
import { Transcript } from "./components/Transcript";
import { Composer } from "./components/Composer";
import { ActivityPanel } from "./components/ActivityPanel";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { CommandPalette } from "./components/CommandPalette";
import { ThreadList } from "./components/ThreadList";
import { Switch } from "./components/Switch";
import { SegmentedControl } from "./components/SegmentedControl";
import { PopAnchor, Popover } from "./components/Popover";
import { Callout, Disclosure, Kbd, SettingGroup, SettingRow, Skeleton, StatusBadge } from "./components/Primitives";
import { Settings } from "./pages/Settings";
import { Wizard } from "./pages/Wizard";
import {
  IconClose,
  IconMore,
  IconSearch,
} from "./components/Icon";
import type { ToolBlock } from "./transcript";

const config = {
  space: { name: "web-01", locale: "en", theme: "dark" },
  agent: { adapter: "cursor", cwd: "/srv/www", model: "grok-4.6", modelParams: [], options: { autoRun: true, sandbox: false } },
  display: { thinkingDefault: "collapsed", diffPreview: true, shellLinesVisible: 12 },
  session: { resumeOnStart: true, stallSeconds: 180, notifyOnComplete: false },
  network: { wsKeepaliveSeconds: 25 },
  prompts: { templates: [] },
  secrets: { adapters: {}, cursorApiKey: { configured: false } },
  onboarding: { completed: true },
  restartRequired: false,
};

const host = { hostLabel: "ops@web-01", cwd: "/srv/www/deploy/current", git: { branch: "main", dirty: true }, adapter: "Cursor" };

const threads = [
  { id: "t1", title: "Disk pressure on web-01", adapter: "cursor", cwd: "/srv/www", updatedAt: new Date(Date.now() - 4e5).toISOString(), usage: { inputTokens: 18240, outputTokens: 3120 } },
  { id: "t2", title: "Rotate nginx certificates", adapter: "cursor", cwd: "/srv/www", updatedAt: new Date(Date.now() - 9e6).toISOString() },
  { id: "t3", title: "Failed timer audit", adapter: "claude", cwd: "/etc/systemd/system", updatedAt: new Date(Date.now() - 9e7).toISOString() },
];

const galleryModels = [
  {
    id: "grok-4.6",
    displayName: "Grok 4.6",
    variants: [
      { displayName: "High", params: [{ id: "effort", value: "high" }] },
      { displayName: "Extra high", params: [{ id: "effort", value: "xhigh" }] },
    ],
  },
  { id: "composer-2.5", displayName: "Composer 2.5" },
];

const opsChips = [
  { id: "status", slash: "status", title: "Host status", text: "Show uptime, load, memory and disk." },
  { id: "disk", slash: "disk", title: "Disk usage", text: "What is eating the disk?" },
  { id: "failed-units", slash: "failed-units", title: "Failed units", text: "List failed systemd units." },
  { id: "logs", slash: "logs", title: "Recent logs", text: "Show the last errors in the journal." },
];

const transcriptBlocks = [
  { id: "u1", kind: "user", text: "Disk on web-01 is at 94%. Find what is eating it and clean up safely." },
  { id: "th1", kind: "thinking", text: "Check df first, then du on the largest mount.", durationMs: 4200 },
  { id: "a1", kind: "text", text: "`/var` is at **94%**. The journal is holding 6.2 GB.\n\n| Path | Size |\n| --- | --- |\n| /var/log/journal | 6.2 GB |" },
];

const threadProps = {
  threads: threads as never, currentId: "t1", locale: "en", busy: false, waiting: false,
  onSwitch: () => {}, onDelete: () => {}, onRename: async () => {},
  git: host.git, currentCwd: "/srv/www", currentAdapter: "cursor", pins: ["/srv/www"], recents: ["/etc/systemd/system"],
  onOpenCwd: () => {}, onPin: () => {}, onUnpin: () => {},
};

/* One with a command, one without: this pair is what exposes row alignment. */
const tools: ToolBlock[] = [
  { id: "s1", kind: "tool", toolKind: "shell", title: "systemctl --failed", status: "done",
    command: "systemctl --failed --no-pager",
    chunk: "● backup.service    loaded failed failed Nightly backup\n● certbot.timer     loaded failed failed Renew certificates" },
  { id: "s2", kind: "tool", toolKind: "read", title: "AGENTS.md", path: "/srv/www/AGENTS.md", status: "done" },
  { id: "s3", kind: "tool", toolKind: "edit", title: "nginx.conf", path: "/etc/nginx/sites-enabled/nginx.conf",
    status: "done", stats: { add: 4, del: 2 },
    diff: "@@ -12,6 +12,7 @@ server {\n-    ssl_protocols TLSv1.1 TLSv1.2;\n+    ssl_protocols TLSv1.2 TLSv1.3;\n+    ssl_prefer_server_ciphers on;\n     root /srv/www;" },
  { id: "s4", kind: "tool", toolKind: "shell", title: "journalctl --vacuum-size=500M", status: "running",
    command: "sudo journalctl --vacuum-size=500M" },
  { id: "s5", kind: "tool", toolKind: "shell", title: "rm -rf /var/lib/postgresql", status: "denied",
    command: "rm -rf /var/lib/postgresql", error: "Auto-review denied this command." },
  { id: "s6", kind: "tool", toolKind: "grep", title: "TLSv1.1", path: "/etc/nginx", status: "error",
    error: "grep: /etc/nginx/private: Permission denied" },
] as ToolBlock[];

/* The transcript the shells and the README screenshots render. */
const runBlocks = [
  ...(transcriptBlocks as never[]),
  ...(tools.slice(0, 4) as unknown as never[]),
];

const activityBlocks = [
  ...(tools as unknown as never[]),
  { id: "u1", kind: "usage", inputTokens: 18240, outputTokens: 3120 },
];

function Row({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section style={{ display: "grid", gap: "12px", marginBottom: "40px" }}>
      <div>
        <h2 style={{ margin: 0, fontSize: "17px" }}>{title}</h2>
        {note ? <p className="muted" style={{ margin: "4px 0 0", fontSize: "12px" }}>{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Frame({ width, height, children }: { width: number | string; height: number; children: ReactNode }) {
  return (
    /* `contain: paint` makes the frame a containing block, so the phone's fixed
       tab bar stays inside its specimen instead of pinning to the gallery. */
    <div style={{ width, height, border: "1px solid var(--stroke)", borderRadius: "14px", overflow: "hidden", position: "relative", contain: "paint" }}>
      {children}
    </div>
  );
}

function ChatShell({
  mobile,
  empty,
  mini,
  inspector,
}: {
  mobile?: boolean;
  empty?: boolean;
  mini?: boolean;
  inspector?: boolean;
}) {
  return (
    <div
      className={`app-shell${mobile ? "" : mini ? " has-mini-rail" : " has-rail"}${inspector ? " has-inspector" : ""}`}
      style={{ height: "100%" }}
    >
      {!mobile && (
        <Sidebar spaceName="web-01" statusClass="connected" statusLabel="Connected" host={host}
          threads={threadProps} onNew={() => {}} onSettings={() => {}} onCopyFailed={() => {}}
          collapsed={Boolean(mini)} onCollapse={() => {}} theme="dark" onTheme={() => {}} />
      )}
      <div className="chat-shell">
        <header className="topbar">
          <div className="topbar-inner">
            <div className="topbar-title">
              <button type="button" className="topbar-heading">
                {mobile && <span className="status dot-only connected" title="Connected" />}
                <strong className="truncate">Disk pressure on web-01</strong>
              </button>
              {mobile ? <HostContext info={host} variant="inline" onCopyFailed={() => {}} />
                      : <span className="host-context muted truncate">www · main (dirty)</span>}
            </div>
            <div className="top-actions">
              {!mobile && <span className="muted usage-chip">↓18.2k ↑3,120</span>}
              <button type="button" className="icon-btn" aria-label="Search"><IconSearch /></button>
              <button type="button" className="icon-btn" aria-label="More"><IconMore /></button>
            </div>
          </div>
        </header>
        <main className="chat-main">
          <div className="transcript">
            <div className="transcript-inner">
              <Transcript
                blocks={empty ? [] : (runBlocks as never)}
                allBlocks={empty ? [] : (runBlocks as never)}
                snapshotReady
                connecting={false}
                search=""
                queuedIds={new Set()}
                locale="en"
                thinkingDefault="collapsed"
                shellLines={12}
                showDiff
                opsChips={opsChips}
                onTemplate={() => {}}
                hostLabel="ops@web-01"
                cwd="/srv/www/deploy/current"
                adapterName="Cursor"
                queue={[]}
              />
            </div>
          </div>
        </main>
        <Composer
          config={config as never}
          onConfig={() => {}}
          caps={{ models: true, sandbox: true, autoRun: true, cancel: true, toolConfirmation: "auto-review-deny" } as never}
          adapterName="Cursor"
          models={galleryModels as never}
          modelId="grok-4.6"
          modelParams={[{ id: "effort", value: "xhigh" }]}
          onModel={() => {}}
          fallbackCatalog={false}
          catalogError=""
          text=""
          onText={() => {}}
          drafts={[]}
          onRemoveDraft={() => {}}
          onAttach={() => {}}
          fileRef={{ current: null }}
          composerRef={{ current: null }}
          onSubmit={(e) => e.preventDefault()}
          onResize={() => {}}
          canSend={false}
          busy={!empty}
          waiting={false}
          onCancel={() => {}}
          queue={[]}
          onQueueCancel={() => {}}
          templates={opsChips as never}
          onTemplate={() => {}}
          slashOpen={false}
          setSlashOpen={() => {}}
          paletteOpen={false}
          onPalette={() => {}}
          status={
            !empty ? (
              <div className="composer-status">
                <span className="pulse" aria-hidden />
                <span className="status-shimmer">Working</span>
                <span className="muted nums">1:12</span>
                <span className="muted truncate status-step">journalctl --vacuum-size=500M</span>
              </div>
            ) : null
          }
        />
      </div>
      {inspector && <ActivityPanel blocks={activityBlocks as never} locale="en" duration="1:12" onClose={() => {}} />}
      {mobile && <BottomNav active="chat" onSelect={() => {}} />}
    </div>
  );
}

function Primitives() {
  const [on, setOn] = useState(true);
  const [seg, setSeg] = useState<"commands" | "files">("commands");
  const [pop, setPop] = useState(false);
  const [open, setOpen] = useState(true);
  return (
    <div style={{ display: "grid", gap: "16px", width: "min(760px, 100%)" }}>
      <div className="row wrap" style={{ alignItems: "center" }}>
        <StatusBadge tone="ok" dot>Signed in</StatusBadge>
        <StatusBadge tone="warn" dot>Auto-run</StatusBadge>
        <StatusBadge tone="danger" dot>Unavailable</StatusBadge>
        <StatusBadge tone="accent">Running</StatusBadge>
        <StatusBadge mono>main@9f2c1ab</StatusBadge>
        <span className="muted">Send with <Kbd>⏎</Kbd>, newline with <Kbd>⇧⏎</Kbd></span>
        <SegmentedControl
          label="Activity view"
          value={seg}
          onChange={setSeg}
          options={[{ value: "commands", label: "Commands" }, { value: "files", label: "Files" }]}
        />
        <PopAnchor>
          <button type="button" className="ghost tiny" aria-expanded={pop} onClick={() => setPop((v) => !v)}>
            Popover
          </button>
          <Popover open={pop} onClose={() => setPop(false)} label="Demo" side="bottom">
            <div className="pop-section">
              <p className="eyebrow">Section</p>
              <Switch checked={on} onChange={setOn} label="Auto-run" hint="Tools run without asking." />
            </div>
          </Popover>
        </PopAnchor>
      </div>
      <Callout tone="warn">Changing the adapter archives this chat and starts a new thread.</Callout>
      <Callout tone="danger" action={<button type="button" className="ghost tiny">Retry</button>}>
        Could not load adapters.
      </Callout>
      <Disclosure open={open} onToggle={() => setOpen((v) => !v)} summary={<span>Thinking · 4s</span>}>
        <p className="muted" style={{ margin: 0 }}>Check df first, then du on the largest mount.</p>
      </Disclosure>
      <SettingGroup title="Execution" hint="How much the agent may do without asking.">
        <SettingRow label="Sandbox" hint="Run tools in Cursor's sandbox.">
          <Switch checked={false} onChange={() => {}} label="Sandbox" hideLabel />
        </SettingRow>
        <SettingRow label="Auto-run" hint="Off means the classifier denies the call.">
          <Switch checked={on} onChange={setOn} label="Auto-run" hideLabel />
        </SettingRow>
        <SettingRow label="Visible shell lines">
          <input type="number" defaultValue={12} />
        </SettingRow>
      </SettingGroup>
      <Skeleton label="Loading the transcript" />
    </div>
  );
}

function Gallery() {
  const [overlay, setOverlay] = useState<"" | "settings" | "wizard" | "palette" | "confirm">("");
  return (
    <div style={{ height: "100%", overflow: "auto", padding: "24px" }}>
      <div className="row wrap" style={{ marginBottom: "24px" }}>
        <strong style={{ marginRight: "auto" }}>Glassys gallery</strong>
        <button type="button" className="ghost" onClick={() => setOverlay("settings")}>Settings</button>
        <button type="button" className="ghost" onClick={() => setOverlay("wizard")}>Wizard</button>
        <button type="button" className="ghost" onClick={() => setOverlay("palette")}>Palette</button>
        <button type="button" className="ghost" onClick={() => setOverlay("confirm")}>Confirm</button>
        <button type="button" className="ghost" onClick={toggleTheme}>Theme</button>
      </div>

      <Row title="Shell — desktop" note="Rail head and topbar title must share a baseline.">
        <Frame width="100%" height={520}><ChatShell /></Frame>
      </Row>
      <Row title="Shell — empty transcript" note="Action cards must fill the last row at every width.">
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
          <Frame width={760} height={480}><ChatShell empty /></Frame>
          <Frame width={420} height={480}><ChatShell mobile empty /></Frame>
        </div>
      </Row>
      <Row title="Shell — phone">
        <Frame width={390} height={720}><ChatShell mobile /></Frame>
      </Row>
      <Row title="Shell — collapsed rail" note="A 56px strip keeps the two controls the operator reaches for.">
        <Frame width="100%" height={420}><ChatShell mini /></Frame>
      </Row>

      <Row title="Tool rows" note="Every row ends at the same x, with or without a copy button.">
        <div style={{ width: "min(760px, 100%)", display: "grid", gap: "12px" }}>
          {tools.map((b) => <ToolCard key={b.id} block={b} shellLines={12} showDiff />)}
        </div>
      </Row>
      <Row title="Tool group" note="A long clean run folds; anything unfinished or failed opens itself.">
        <div style={{ width: "min(760px, 100%)", display: "grid", gap: "12px" }}>
          <ToolGroup blocks={tools as never} shellLines={12} showDiff />
        </div>
      </Row>

      <Row title="Alerts and queue">
        <div style={{ width: "min(760px, 100%)", display: "grid", gap: "12px" }}>
          <AlertStack alerts={[
            { id: "w", tone: "warn", text: "Glassys is bound to 127.0.0.1, so your phone cannot reach it.", onDismiss: () => {} },
            { id: "e", tone: "error", text: "Could not load adapters.", action: { label: "Retry", run: () => {} } },
            { id: "i", tone: "info", text: "Restarting the gateway…" },
          ]} />
          <div className="queue-band">
            <p className="eyebrow">Queued · <span className="nums">2</span></p>
            <ul className="queue-list">
              <li><span className="truncate">Schedule: nightly backup report</span><button type="button" className="icon-btn sm" aria-label="Remove"><IconClose /></button></li>
              <li><span className="truncate">Then restart caddy and confirm it came back</span><button type="button" className="icon-btn sm" aria-label="Remove"><IconClose /></button></li>
            </ul>
          </div>
        </div>
      </Row>

      <Row title="Thread list">
        <div style={{ width: "268px", background: "var(--surface-1)", padding: "12px", borderRadius: "14px" }}>
          <ThreadList {...threadProps} />
        </div>
      </Row>

      <Row title="Controls" note="Every single-line control is one control height.">
        <div className="row wrap" style={{ alignItems: "center" }}>
          <button type="button" className="primary">Primary</button>
          <button type="button" className="ghost">Ghost</button>
          <button type="button" className="danger">Danger</button>
          <button type="button" className="ghost tiny">Tiny chip</button>
          <button type="button" className="icon-btn" aria-label="Icon"><IconSearch /></button>
          <button type="button" className="icon-btn sm" aria-label="Small icon"><IconClose /></button>
          <input style={{ width: "160px" }} placeholder="Input" />
          <select style={{ width: "160px" }}><option>Select</option></select>
          <span className="status connected">Connected</span>
        </div>
      </Row>

      <Row title="Activity" note="What the thread did to the host: commands and files, read off the transcript.">
        <div style={{ width: "320px", height: "420px", background: "var(--surface-1)", borderRadius: "14px", overflow: "hidden" }}>
          <ActivityPanel blocks={activityBlocks as never} locale="en" duration="1:12" onClose={() => {}} />
        </div>
      </Row>

      <Row title="Primitives" note="One switch, one badge, one callout, one disclosure, one setting row.">
        <Primitives />
      </Row>

      {overlay === "settings" && (
        <Settings config={config as never} onClose={() => setOverlay("")} onConfig={() => {}} onLogout={() => {}} currentThreadId="t1" />
      )}
      {overlay === "wizard" && (
        <div className="settings-overlay" onClick={() => setOverlay("")}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(760px, 100%)" }}>
            <Wizard config={config as never} onConfig={() => {}} onDone={() => setOverlay("")} />
          </div>
        </div>
      )}
      {overlay === "palette" && (
        <CommandPalette open query="" onClose={() => setOverlay("")} onQuery={() => {}} items={[
          { id: "new", group: "product", label: "New thread", run: () => {} },
          { id: "cancel", group: "product", label: "Cancel run", run: () => {} },
          { id: "w1", group: "workspace", label: "www", hint: "/srv/www", run: () => {} },
          { id: "t1", group: "template", label: "Host status", hint: "/status", run: () => {} },
        ]} />
      )}
      {overlay === "confirm" && (
        <ConfirmDialog
          request={{ message: "Delete this thread and its transcript? This cannot be undone.", confirmLabel: "Delete", destructive: true }}
          onResolve={() => setOverlay("")}
        />
      )}
    </div>
  );
}

function toggleTheme() {
  const root = document.documentElement;
  const next = root.dataset.theme === "light" ? "dark" : "light";
  root.dataset.theme = next;
  root.style.colorScheme = next;
}

document.documentElement.dataset.theme = new URLSearchParams(location.search).get("t") === "light" ? "light" : "dark";
document.documentElement.style.colorScheme = document.documentElement.dataset.theme;

/**
 * `?shot=desktop` and `?shot=phone` render a single shell edge to edge. The
 * README screenshots in docs/assets are captured from these, at 2x:
 *   Chrome --headless --window-size=1320,880 --force-device-scale-factor=2
 */
const shot = new URLSearchParams(location.search).get("shot");

createRoot(document.getElementById("root")!).render(
  shot === "desktop" || shot === "phone" ? (
    <I18nProvider locale="en">
      <div className="app">
        {shot === "desktop" ? <ChatShell inspector /> : <ChatShell mobile />}
      </div>
    </I18nProvider>
  ) : (
    <I18nProvider locale="en"><div className="app"><Gallery /></div></I18nProvider>
  ),
);
