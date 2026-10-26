import { useState } from "react";
import type { HostCapabilities, ServiceScope } from "@glassys/protocol";
import { api } from "../../api";
import { useT } from "../../i18n";
import { SegmentedControl } from "../../components/SegmentedControl";
import { IconGauge, IconLogs, IconServices } from "../../components/Icon";
import type { Draft, HostSource, HostViewId } from "./shared";
import { OverviewView } from "./OverviewView";
import { ServicesView } from "./ServicesView";
import { LogsView, MAX_LOG_ROWS } from "./LogsView";
import { FilesView } from "./FilesView";

/*
 * Host views: what a code UI shows as Files and Git, in systems terms. They
 * observe; every action drafts a prompt into the composer and returns to the
 * chat, so the agent — with its sandbox and auto-run settings — is still the
 * only thing that changes the machine.
 */

/* One import site for the app, the gallery and the tests. */
export { FilesView, LogsView, MAX_LOG_ROWS, OverviewView, ServicesView };
export type { HostSource, HostViewId };

/** The views with their shared navigation, as the app mounts them. */
export function HostViews({
  view,
  onView,
  caps,
  source = api,
  locale,
  cwd,
  narrow,
  onDraft,
  onMention,
}: {
  view: HostViewId;
  onView: (v: HostViewId) => void;
  caps: HostCapabilities | null;
  source?: HostSource;
  locale: string;
  cwd: string;
  narrow: boolean;
  onDraft: Draft;
  onMention: (text: string) => void;
}) {
  const t = useT();
  const [logUnit, setLogUnit] = useState("");
  /* A user-scope unit's journal is the user journal; asking the system one shows nothing. */
  const [logScope, setLogScope] = useState<ServiceScope>("system");
  return (
    <main className="host-main">
      <h1 className="visually-hidden">{t(`nav.${view}`)}</h1>
      {/* On a phone the three machine views share one tab, and this switches
          between them; on a desktop the topbar's tabs do. */}
      {narrow && view !== "files" ? (
        <div className="host-subnav">
          <SegmentedControl
            label={t("nav.host")}
            value={view}
            onChange={onView}
            options={[
              { value: "overview", label: t("nav.overview"), glyph: <IconGauge /> },
              { value: "services", label: t("nav.services"), glyph: <IconServices /> },
              { value: "logs", label: t("nav.logs"), glyph: <IconLogs /> },
            ]}
          />
        </div>
      ) : null}
      {view === "overview" && <OverviewView source={source} caps={caps} locale={locale} onDraft={onDraft} onView={onView} />}
      {view === "services" && (
        <ServicesView
          source={source}
          caps={caps}
          onDraft={onDraft}
          onLogs={(unit, scope) => {
            setLogUnit(unit);
            setLogScope(scope);
            onView("logs");
          }}
        />
      )}
      {view === "logs" && (
        <LogsView
          source={source}
          caps={caps}
          locale={locale}
          unit={logUnit}
          scope={logScope}
          onUnit={(unit) => {
            setLogUnit(unit);
            setLogScope("system");
          }}
          onDraft={onDraft}
        />
      )}
      {view === "files" && (
        <FilesView source={source} start={cwd} locale={locale} onDraft={onDraft} onMention={onMention} narrow={narrow} />
      )}
    </main>
  );
}
