import type { PromptTemplate } from "@glassys/protocol";
import { useT } from "../../i18n";

export function PromptsTab({
  templates,
  setTemplates,
}: {
  templates: PromptTemplate[];
  setTemplates: (next: PromptTemplate[]) => void;
}) {
  const t = useT();
  return (
    <>
      <p className="muted">{t("settings.promptsHint")}</p>
      {templates.map((tpl, i) => (
        <div key={tpl.id} className="prompt-row">
          <label>
            {t("settings.promptSlash")}
            <input
              value={tpl.slash}
              onChange={(e) => {
                const next = templates.slice();
                next[i] = { ...tpl, slash: e.target.value, id: tpl.id || e.target.value };
                setTemplates(next);
              }}
            />
          </label>
          <label>
            {t("settings.promptTitle")}
            <input
              value={tpl.title}
              onChange={(e) => {
                const next = templates.slice();
                next[i] = { ...tpl, title: e.target.value };
                setTemplates(next);
              }}
            />
          </label>
          <label>
            {t("settings.promptText")}
            <textarea
              rows={3}
              value={tpl.text}
              onChange={(e) => {
                const next = templates.slice();
                next[i] = { ...tpl, text: e.target.value };
                setTemplates(next);
              }}
            />
          </label>
          <button
            type="button"
            className="ghost tiny"
            onClick={() => setTemplates(templates.filter((_, j) => j !== i))}
          >
            {t("settings.promptRemove")}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="ghost"
        onClick={() =>
          setTemplates([
            ...templates,
            { id: `tpl-${templates.length + 1}`, slash: "", title: "", text: "" },
          ])
        }
      >
        {t("settings.promptAdd")}
      </button>
    </>
  );
}
