import { useState } from "react";
import type { PromptTemplate } from "@glassys/protocol";
import { useT } from "../../i18n";
import { Disclosure, EmptyRow, SettingGroup, SettingRow } from "../../components/Primitives";
import { IconPlus, IconTrash, IconZap } from "../../components/Icon";

/**
 * A list of saved operations, not a stack of forms: every template used to
 * render three labelled fields and a remove button, so five prompts filled the
 * dialog twice over.
 */
export function PromptsTab({
  templates,
  setTemplates,
}: {
  templates: PromptTemplate[];
  setTemplates: (next: PromptTemplate[]) => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState<string | null>(null);

  function patch(i: number, over: Partial<PromptTemplate>) {
    const next = templates.slice();
    next[i] = { ...templates[i]!, ...over };
    setTemplates(next);
  }

  const addButton = (
    <button
      type="button"
      className="ghost"
      onClick={() => {
        const id = `tpl-${templates.length + 1}`;
        setTemplates([...templates, { id, slash: "", title: "", text: "" }]);
        setEditing(id);
      }}
    >
      <IconPlus />
      {t("settings.promptAdd")}
    </button>
  );

  return (
    <SettingGroup hint={t("settings.promptsHint")}>
      {templates.map((tpl, i) => (
        <SettingRow key={tpl.id || i} stack>
          <Disclosure
            open={editing === (tpl.id || String(i))}
            onToggle={() => setEditing((cur) => (cur === (tpl.id || String(i)) ? null : tpl.id || String(i)))}
            summary={
              <span className="prompt-summary">
                <code>{tpl.slash ? `/${tpl.slash.replace(/^\//, "")}` : t("settings.promptSlash")}</code>
                <span className="truncate">{tpl.title || t("settings.promptTitle")}</span>
              </span>
            }
            meta={
              <button
                type="button"
                className="icon-btn sm danger-hover"
                aria-label={t("settings.promptRemove")}
                title={t("settings.promptRemove")}
                onClick={() => setTemplates(templates.filter((_, j) => j !== i))}
              >
                <IconTrash />
              </button>
            }
          >
            <div className="stack">
              <label>
                {t("settings.promptSlash")}
                <input
                  value={tpl.slash}
                  onChange={(e) => patch(i, { slash: e.target.value, id: tpl.id || e.target.value })}
                />
              </label>
              <label>
                {t("settings.promptTitle")}
                <input value={tpl.title} onChange={(e) => patch(i, { title: e.target.value })} />
              </label>
              <label>
                {t("settings.promptText")}
                <textarea rows={3} value={tpl.text} onChange={(e) => patch(i, { text: e.target.value })} />
              </label>
            </div>
          </Disclosure>
        </SettingRow>
      ))}
      {templates.length === 0 ? (
        <EmptyRow glyph={<IconZap />} action={addButton}>
          {t("settings.promptsEmpty")}
        </EmptyRow>
      ) : (
        <SettingRow>{addButton}</SettingRow>
      )}
    </SettingGroup>
  );
}
