import { useEffect, useState } from "react";
import { api } from "../api";
import { useT } from "../i18n";
import { operatorError } from "../operatorError";
import { Disclosure } from "./Primitives";
import { IconFolder, IconSearch } from "./Icon";

function cwdName(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function WorkspacePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (cwd: string) => void;
}) {
  const t = useT();
  const [root, setRoot] = useState("");
  const [recents, setRecents] = useState<string[]>([]);
  const [pins, setPins] = useState<string[]>([]);
  const [hits, setHits] = useState<{ path: string; name: string }[]>([]);
  const [error, setError] = useState("");
  const [browseOpen, setBrowseOpen] = useState<boolean | null>(null);
  const browsing = browseOpen ?? !value.trim();

  useEffect(() => {
    void load();
  }, []);

  async function load(nextRoot?: string) {
    setError("");
    try {
      const r = await api.workspaces(nextRoot);
      setRecents(r.recents);
      setPins(r.pins || []);
      setHits(r.workspaces);
    } catch (err) {
      setHits([]);
      setError(operatorError(err instanceof Error ? err.message : t("wizard.workspace.browseFailed"), t));
    }
  }

  return (
    <div className="stack">
      <label>
        {t("wizard.workspace.path")}
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={t("wizard.workspace.pathPlaceholder")} />
      </label>
      {(pins.length > 0 || recents.some((p) => !pins.includes(p))) && (
        <div className="picker-list">
          <p className="eyebrow">{pins.length > 0 ? t("threads.pins") : t("wizard.workspace.recent")}</p>
          {[...pins, ...recents.filter((p) => !pins.includes(p))].map((p) => (
            <button key={p} type="button" className="ghost picker-item" onClick={() => onChange(p)}>
              <IconFolder />
              <strong>{cwdName(p)}</strong>
              <span className="muted">{p}</span>
            </button>
          ))}
        </div>
      )}
      {/* Scanning for folders is the second way in, so it waits behind one
          line instead of a second input stacked under the path. It opens by
          itself when there is no path yet. */}
      <Disclosure open={browsing} onToggle={() => setBrowseOpen(!browsing)} summary={<span>{t("wizard.workspace.browse")}</span>}>
        <div className="stack">
          {/* Field and action on one line: they are one gesture. */}
          <div className="input-group">
            <input
              value={root}
              aria-label={t("wizard.workspace.browseRoot")}
              onChange={(e) => setRoot(e.target.value)}
              placeholder={t("wizard.workspace.browsePlaceholder")}
            />
            <button type="button" className="ghost" onClick={() => void load(root.trim() || undefined)}>
              <IconSearch />
              {t("wizard.workspace.browse")}
            </button>
          </div>
          {error && <p className="error-text">{error}</p>}
          {hits.length > 0 && (
            <div className="picker-list">
              {hits.map((h) => (
                <button key={h.path} type="button" className="ghost picker-item" onClick={() => onChange(h.path)}>
                  <IconFolder />
                  <strong>{h.name}</strong>
                  <span className="muted">{h.path}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </Disclosure>
    </div>
  );
}
