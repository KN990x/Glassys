import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ServiceUnit } from "@glassys/protocol";
import { api } from "../../api";
import { useT } from "../../i18n";
import { operatorError } from "../../operatorError";
import type { Tone } from "../../components/Primitives";
import { IconRefresh } from "../../components/Icon";

/** What the host views share: their data source, the loader, the page head. */

export type HostViewId = "overview" | "services" | "logs" | "files";

/** Where the views read from. The app passes the gateway; the gallery a fake. */
export type HostSource = Pick<typeof api, "hostOverview" | "hostServices" | "hostLogs" | "hostFiles" | "hostFile">;

export type Draft = (text: string) => void;

export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const t = useT();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const gen = ++generation.current;
    setLoading(true);
    try {
      const next = await load();
      if (gen !== generation.current) return;
      setData(next);
      setError("");
    } catch (err) {
      if (gen !== generation.current) return;
      setError(operatorError(err instanceof Error ? err.message : t("host.loadFailed"), t));
    } finally {
      if (gen === generation.current) setLoading(false);
    }
    /* useLoad passes its caller's dependency list through, like useEffect itself; the caller's
       list is what decides when to reload. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  /* New deps ask for something else (another file, another folder): what was shown belongs to the
     old ask, so it goes instead of sitting under the new path. A manual reload() keeps it. */
  useEffect(() => {
    setData(null);
    setError("");
    void reload();
    return () => {
      generation.current += 1;
    };
  }, [reload]);
  return { data, error, loading, reload };
}

export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? "");
}

export function HostHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="host-head">
      <div className="host-head-text">
        <h2 className="truncate">{title}</h2>
        {sub ? <p className="host-sub truncate">{sub}</p> : null}
      </div>
      {children ? <div className="host-head-actions">{children}</div> : null}
    </header>
  );
}

export function RefreshButton({ onClick, busy }: { onClick: () => void; busy?: boolean }) {
  const t = useT();
  return (
    <button
      type="button"
      className={`icon-btn${busy ? " spinning" : ""}`}
      onClick={onClick}
      aria-label={t("host.refresh")}
      title={t("host.refresh")}
    >
      <IconRefresh />
    </button>
  );
}

// ---------------------------------------------------------------- overview

export function UnitState({ unit }: { unit: ServiceUnit }) {
  return <span className={`unit-state tone-${unitTone(unit)}`}>{unit.sub || unit.active}</span>;
}

export function unitTone(u: ServiceUnit): Tone {
  if (u.active === "failed") return "danger";
  if (u.active === "active") return "ok";
  if (u.active === "activating" || u.active === "deactivating" || u.active === "reloading") return "warn";
  return "neutral";
}
