import { useEffect, useState } from "react";
import { api } from "../api";
import { useT } from "../i18n";

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
      setError(err instanceof Error ? err.message : t("wizard.workspace.browseFailed"));
    }
  }

  return (
    <div className="stack">
      <label>
        {t("wizard.workspace.path")}
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="/home/you" />
      </label>
      {pins.length > 0 && (
        <div className="picker-list">
          <p className="muted">{t("threads.pins")}</p>
          {pins.map((p) => (
            <button key={`pin:${p}`} type="button" className="ghost picker-item" onClick={() => onChange(p)}>
              {p}
            </button>
          ))}
        </div>
      )}
      {recents.filter((p) => !pins.includes(p)).length > 0 && (
        <div className="picker-list">
          <p className="muted">{t("wizard.workspace.recent")}</p>
          {recents
            .filter((p) => !pins.includes(p))
            .map((p) => (
            <button key={p} type="button" className="ghost picker-item" onClick={() => onChange(p)}>
              {p}
            </button>
          ))}
        </div>
      )}
      <label>
        {t("wizard.workspace.browseRoot")}
        <input value={root} onChange={(e) => setRoot(e.target.value)} placeholder="/opt" />
      </label>
      <button
        type="button"
        className="ghost"
        onClick={() => void load(root.trim() || undefined)}
      >
        {t("wizard.workspace.browse")}
      </button>
      {error && <p className="error-text">{error}</p>}
      {hits.length > 0 && (
        <div className="picker-list">
          {hits.map((h) => (
            <button key={h.path} type="button" className="ghost picker-item" onClick={() => onChange(h.path)}>
              <strong>{h.name}</strong>
              <span className="muted">{h.path}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
