import type { PromptTemplate, Theme, ThreadSummary } from "@glassys/protocol";
import { cwdBasename } from "../format";
import { templatePaletteItems, type PaletteItem } from "../components/CommandPalette";
import { nextTheme } from "../components/Sidebar";
import type { AppView } from "../components/ViewTabs";
import {
  IconActivity,
  IconClock,
  IconExport,
  IconFiles,
  IconFolder,
  IconGauge,
  IconLogs,
  IconMoon,
  IconPlus,
  IconRailClose,
  IconRailOpen,
  IconRefresh,
  IconSearch,
  IconServices,
  IconSettings,
  IconStop,
  IconThreads,
} from "../components/Icon";

export type PaletteActions = {
  newThread: () => void;
  cancel: () => void;
  exportThread: () => void;
  openSettings: (section?: "schedules" | "updates", prefill?: string) => void;
  toggleActivity: (next: boolean) => void;
  collapseRail: (next: boolean) => void;
  changeTheme: (next: Theme) => void;
  openSearch: () => void;
  restart: () => void;
  switchThread: (id: string) => void;
  openCwd: (cwd: string) => void;
  insertTemplate: (text: string) => void;
  showView: (view: AppView) => void;
};

/**
 * Everything ⌘K can reach: commands, the host views, the other threads, the
 * known workspaces and the saved prompts. The palette is the one place to find
 * any of them by name, now that the rail has no filter field.
 */
export function buildPaletteItems(ctx: {
  t: (key: string) => string;
  theme: Theme;
  railCollapsed: boolean;
  activityOpen: boolean;
  draft: string;
  threads: ThreadSummary[];
  currentThreadId: string | null;
  workspaces: string[];
  templates: PromptTemplate[];
  actions: PaletteActions;
}): PaletteItem[] {
  const { t, actions: a } = ctx;
  return [
    { id: "new", group: "product", label: t("palette.newThread"), glyph: <IconPlus />, kbd: "⌘⇧O", run: a.newThread },
    { id: "cancel", group: "product", label: t("palette.cancel"), glyph: <IconStop />, kbd: "esc", run: a.cancel },
    { id: "export", group: "product", label: t("palette.export"), glyph: <IconExport />, run: a.exportThread },
    { id: "view:overview", group: "product", label: t("nav.overview"), glyph: <IconGauge />, run: () => a.showView("overview") },
    { id: "view:services", group: "product", label: t("nav.services"), glyph: <IconServices />, run: () => a.showView("services") },
    { id: "view:logs", group: "product", label: t("nav.logs"), glyph: <IconLogs />, run: () => a.showView("logs") },
    { id: "view:files", group: "product", label: t("nav.files"), glyph: <IconFiles />, run: () => a.showView("files") },
    { id: "settings", group: "product", label: t("palette.settings"), glyph: <IconSettings />, run: () => a.openSettings() },
    {
      id: "activity",
      group: "product",
      label: t("nav.activity"),
      glyph: <IconActivity />,
      kbd: "⌘I",
      run: () => a.toggleActivity(!ctx.activityOpen),
    },
    {
      id: "rail",
      group: "product",
      label: t(ctx.railCollapsed ? "nav.expandRail" : "nav.collapseRail"),
      glyph: ctx.railCollapsed ? <IconRailOpen /> : <IconRailClose />,
      kbd: "⌘B",
      run: () => a.collapseRail(!ctx.railCollapsed),
    },
    {
      id: "theme",
      group: "product",
      label: t("settings.theme"),
      glyph: <IconMoon />,
      run: () => a.changeTheme(nextTheme(ctx.theme)),
    },
    { id: "search", group: "product", label: t("palette.search"), glyph: <IconSearch />, kbd: "⌘F", run: a.openSearch },
    { id: "restart", group: "product", label: t("palette.restart"), glyph: <IconRefresh />, run: a.restart },
    { id: "upgrade", group: "product", label: t("palette.upgrade"), glyph: <IconRefresh />, run: () => a.openSettings("updates") },
    {
      id: "schedule",
      group: "product",
      label: t("palette.schedule"),
      glyph: <IconClock />,
      run: () => {
        const body = ctx.draft.trim();
        if (body) a.openSettings("schedules", body);
      },
    },
    ...ctx.threads
      .filter((th) => th.id !== ctx.currentThreadId)
      .map((th) => ({
        id: `thread:${th.id}`,
        group: "thread" as const,
        label: th.title || t("threads.untitled"),
        hint: cwdBasename(th.cwd),
        glyph: <IconThreads />,
        run: () => a.switchThread(th.id),
      })),
    ...ctx.workspaces.map((cwd) => ({
      id: `cwd:${cwd}`,
      group: "workspace" as const,
      label: cwdBasename(cwd),
      hint: cwd,
      glyph: <IconFolder />,
      run: () => a.openCwd(cwd),
    })),
    ...templatePaletteItems(ctx.templates, t, a.insertTemplate),
  ];
}
