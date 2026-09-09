/**
 * Component gallery. Dev only: Vite builds `index.html` and nothing else, so
 * this never reaches `dist/`. Open it with `pnpm dev` at /gallery.html.
 *
 * It exists so a whole-UI review is one page instead of a throwaway harness
 * rebuilt from memory each time, and so defects that only show up when two
 * components sit side by side — a status pill that lands 38px off, a rail that
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
import { ToolCard } from "./components/ToolCard";
import { Thinking } from "./components/Thinking";
import { MarkdownBody } from "./components/MarkdownBody";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { CommandPalette } from "./components/CommandPalette";
import { ThreadList } from "./components/ThreadList";
import { Settings } from "./pages/Settings";
import { Wizard } from "./pages/Wizard";
import {
  GlassysMark,
  IconAttach,
  IconClose,
  IconExport,
  IconSearch,
  IconSend,
  IconThreads,
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

const threadProps = {
  threads: threads as never, currentId: "t1", locale: "en", busy: false, waiting: false,
  onSwitch: () => {}, onDelete: () => {}, onRename: async () => {},
  git: host.git, currentCwd: "/srv/www", pins: ["/srv/www"], recents: ["/etc/systemd/system"],
  onOpenCwd: () => {}, onPin: () => {}, onUnpin: () => {},
};

/* One with a command, one without: this pair is what exposes pill alignment. */
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

function ChatShell({ mobile, empty }: { mobile?: boolean; empty?: boolean }) {
  return (
    <div className={`app-shell${mobile ? "" : " has-rail"}`} style={{ height: "100%" }}>
      {!mobile && (
        <Sidebar spaceName="web-01" statusClass="connected" statusLabel="Connected" host={host}
          threads={threadProps} onNew={() => {}} onSettings={() => {}} onExport={() => {}} canExport onCopyFailed={() => {}} />
      )}
      <div className="chat-shell">
        <header className="topbar">
          <div className="topbar-inner">
            {mobile && <button type="button" className="icon-btn" aria-label="Threads"><IconThreads /></button>}
            <div className="topbar-title">
              <strong className="truncate">{mobile ? "web-01" : "Disk pressure on web-01"}</strong>
              {mobile ? <HostContext info={host} variant="inline" onCopyFailed={() => {}} />
                      : <span className="host-context muted truncate">current</span>}
            </div>
            <div className="top-actions">
              {mobile ? <span className="status dot-only connected" title="Connected" />
                      : <span className="muted usage-chip">↓18.2k ↑3.1k</span>}
            </div>
          </div>
        </header>
        <main className="chat-main">
          <div className="transcript-toolbar">
            <span className="search-field"><IconSearch /><input type="search" placeholder="Search this thread" /></span>
            <button type="button" className="icon-btn" aria-label="Export"><IconExport /></button>
          </div>
          <div className="transcript">
            <div className="transcript-inner">
              {empty ? (
                <div className="empty">
                  <GlassysMark size={30} />
                  <h2>Ready on this host</h2>
                  <p className="muted">Ask for anything on this machine. Files, services, logs, git.</p>
                  <p className="muted empty-host">ops@web-01 · /srv/www/deploy/current · Cursor</p>
                  <div className="empty-actions">
                    <button type="button" className="ghost empty-action"><strong>Host status</strong><span className="muted">/status</span></button>
                    <button type="button" className="ghost empty-action"><strong>Disk usage</strong><span className="muted">/disk</span></button>
                    <button type="button" className="ghost empty-action"><strong>Failed units</strong><span className="muted">/failed-units</span></button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="bubble user">Disk on web-01 is at 94%. Find what is eating it and clean up safely.</div>
                  <Thinking text="Check df first, then du on the largest mount." durationMs={4200} defaultOpen={false} />
                  <div className="bubble assistant">
                    <MarkdownBody text={"`/var` is at **94%**. The journal is holding 6.2 GB.\n\n| Path | Size |\n| --- | --- |\n| /var/log/journal | 6.2 GB |"} />
                  </div>
                  <ToolCard block={tools[0]} shellLines={12} showDiff />
                  <ToolCard block={tools[1]} shellLines={12} showDiff />
                  <div className="working"><span className="pulse" aria-hidden /><span className="working-text">Working · Elapsed 1:12 · systemctl reload nginx</span></div>
                </>
              )}
            </div>
          </div>
        </main>
        <form className="composer" onSubmit={(e) => e.preventDefault()}>
          <div className="composer-inner">
            <div className="composer-meta">
              <div className="model-picker compact">
                <label>Model<select defaultValue="a"><option value="a">Grok 4.6 · Extra high</option></select></label>
              </div>
              <button type="button" className="ghost tiny">Auto-run on · Sandbox off</button>
            </div>
            <div className="composer-box">
              <button type="button" className="ghost composer-attach" aria-label="Attach"><IconAttach /></button>
              <textarea rows={1} placeholder="Ask about this host…" />
              <button type="submit" className="primary composer-send" aria-label="Send"><IconSend /></button>
            </div>
            <p className="muted composer-hint composer-shortcut">⌘K for commands · / for saved prompts</p>
          </div>
        </form>
      </div>
      {mobile && <BottomNav active="chat" onSelect={() => {}} />}
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

      <Row title="Tool cards" note="Every status pill must end at the same x, with or without a copy button.">
        <div style={{ width: "min(760px, 100%)", display: "grid", gap: "12px" }}>
          {tools.map((b) => <ToolCard key={b.id} block={b} shellLines={12} showDiff />)}
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
          <span className="pill done">Done</span>
          <span className="pill running">Running</span>
          <span className="pill denied">Denied</span>
          <span className="status connected">Connected</span>
        </div>
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

createRoot(document.getElementById("root")!).render(
  <I18nProvider locale="en"><div className="app"><Gallery /></div></I18nProvider>,
);
