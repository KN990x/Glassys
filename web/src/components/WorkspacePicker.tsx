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
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="/home/you/src/project" />
      </label>
      {recents.length > 0 && (
        <div className="picker-list">
          <p className="muted">{t("wizard.workspace.recent")}</p>
          {recents.map((p) => (
            <button key={p} type="button" className="ghost picker-item" onClick={() => onChange(p)}>
              {p}
            </button>
          ))}
        </div>
      )}
      <label>
        {t("wizard.workspace.browseRoot")}
        <input value={root} onChange={(e) => setRoot(e.target.value)} placeholder="/home/you/src" />
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
