import { useState } from "react";
import type { HostCapabilities, ServiceScope, ServiceStateFilter } from "@glassys/protocol";
import { useT } from "../../i18n";
import { Callout, ListRow, Skeleton } from "../../components/Primitives";
import { SegmentedControl } from "../../components/SegmentedControl";
import { IconLogs, IconRestart, IconSearch, IconZap } from "../../components/Icon";
import { HostHead, RefreshButton, UnitState, fill, unitTone, useLoad, type Draft, type HostSource } from "./shared";

/** Services: the unit list, filtered by state, with an action that drafts a prompt per unit. */

export function ServicesView({
  source,
  caps,
  onDraft,
  onLogs,
}: {
  source: HostSource;
  caps: HostCapabilities | null;
  onDraft: Draft;
  onLogs: (unit: string, scope: ServiceScope) => void;
}) {
  const t = useT();
  const [state, setState] = useState<ServiceStateFilter>("all");
  const [scope, setScope] = useState<ServiceScope>("system");
  const [q, setQ] = useState("");
  const [openUnit, setOpenUnit] = useState<string | null>(null);
  const services = useLoad(
    () => (caps?.services ? source.hostServices(scope, state).then((r) => r.units) : Promise.resolve([])),
    [source, scope, state, caps?.services],
  );
  const needle = q.trim().toLowerCase();
  const units = (services.data ?? []).filter(
    (u) => !needle || u.name.toLowerCase().includes(needle) || u.description.toLowerCase().includes(needle),
  );
  const failedCount = (services.data ?? []).filter((u) => u.active === "failed").length;

  if (caps && !caps.services) {
    return (
      <div className="host-page">
        <HostHead title={t("nav.services")} />
        <Callout>{t("host.servicesUnavailable")}</Callout>
      </div>
    );
  }

  return (
    <div className="host-page">
      <HostHead
        title={t("nav.services")}
        sub={
          services.data ? (
            <>
              <span className="nums">{services.data.length}</span> {t("services.count")}
              {failedCount ? (
                <>
                  {" · "}
                  <span className="danger-text">
                    <span className="nums">{failedCount}</span> {t("services.failedCount")}
                  </span>
                </>
              ) : null}
            </>
          ) : undefined
        }
      >
        <RefreshButton busy={services.loading} onClick={() => void services.reload()} />
      </HostHead>

      <div className="host-toolbar">
        <SegmentedControl
          label={t("nav.services")}
          value={state}
          onChange={setState}
          options={[
            { value: "all", label: t("services.all") },
            { value: "active", label: t("services.active") },
            { value: "failed", label: t("services.failed") },
          ]}
        />
        <label className="search-field host-search">
          <span className="visually-hidden">{t("services.filter")}</span>
          <IconSearch />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("services.filter")} />
        </label>
        {/* Scope ends the row: beside the state filter the two read as one
            five-way switch. */}
        {caps?.services === "systemd" ? (
          <SegmentedControl
            label={t("services.scope")}
            value={scope}
            onChange={setScope}
            options={[
              { value: "system", label: t("services.system") },
              { value: "user", label: t("services.user") },
            ]}
          />
        ) : null}
      </div>

      {services.error ? <Callout tone="danger">{services.error}</Callout> : null}
      {!services.data && services.loading ? <Skeleton rows={6} label={t("host.loading")} /> : null}
      {services.data ? (
        <div className="host-card list">
          {units.length === 0 ? <p className="muted host-empty">{t("services.empty")}</p> : null}
          {/* Tapping a unit opens its actions under it: the same gesture with a
              pointer or a thumb, where hover-only buttons did not exist on a
              phone. */}
          {units.map((u) => (
            <div key={u.name} className={`unit-item${openUnit === u.name ? " open" : ""}`}>
              <ListRow
                className="unit-row"
                glyph={<span className={`unit-dot tone-${unitTone(u)}`} />}
                tail={<UnitState unit={u} />}
                title={u.description || u.name}
                current={openUnit === u.name}
                onClick={() => setOpenUnit((cur) => (cur === u.name ? null : u.name))}
              >
                <span className="unit-name">{u.name}</span>
                {u.description ? <span className="unit-desc">{u.description}</span> : null}
              </ListRow>
              {openUnit === u.name ? (
                <div className="unit-actions">
                  <button type="button" className="ghost tiny" onClick={() => onLogs(u.name, scope)}>
                    <IconLogs />
                    {t("services.logs")}
                  </button>
                  <button
                    type="button"
                    className="ghost tiny"
                    onClick={() => onDraft(fill(t("prompt.draft.diagnose"), { unit: u.name, state: u.sub || u.active }))}
                  >
                    <IconZap />
                    {t("services.diagnose")}
                  </button>
                  <button
                    type="button"
                    className="ghost tiny"
                    onClick={() => onDraft(fill(t("prompt.draft.restart"), { unit: u.name }))}
                  >
                    <IconRestart />
                    {t("services.restart")}
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
