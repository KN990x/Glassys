import type { ModelCatalogItem, ModelParam } from "@glassys/protocol";
import { matchingVariant, modelOptionLabel, variantOptionLabel } from "@glassys/protocol";
import { useT } from "../i18n";
import { applyVariant, boolParam, extraDefs, paramValue, paramsForSelection, setParam } from "../modelParams";

export function ModelPicker({
  models,
  modelId,
  params,
  onChange,
  compact,
  preferred,
}: {
  models: ModelCatalogItem[];
  modelId: string;
  params: ModelParam[];
  onChange: (id: string, params: ModelParam[]) => void;
  compact?: boolean;
  preferred?: { id: string; params: ModelParam[] };
}) {
  const t = useT();
  const catalog = models;
  const selected = catalog.find((m) => m.id === modelId) ?? catalog.find((m) => m.id === preferred?.id) ?? catalog[0];
  const variant = matchingVariant(selected, params);
  const extras = selected ? extraDefs(selected) : [];

  function pickModel(id: string) {
    const model = catalog.find((m) => m.id === id) ?? catalog[0];
    if (!model) return;
    onChange(model.id, paramsForSelection(model, preferred));
  }

  function pickVariant(index: string) {
    if (!selected?.variants) return;
    const next = selected.variants[Number(index)];
    if (!next) return;
    onChange(selected.id, applyVariant(selected, next.params, params));
  }

  if (!catalog.length) {
    return <p className="muted">{t("wizard.model.empty")}</p>;
  }

  return (
    <div className={compact ? "model-picker compact" : "model-picker"}>
      <label>
        {compact ? t("chat.model") : t("wizard.step.model")}
        <select value={selected?.id ?? modelId} onChange={(e) => pickModel(e.target.value)}>
          {catalog.map((m) => (
            <option key={m.id} value={m.id}>
              {modelOptionLabel(m, catalog)}
            </option>
          ))}
        </select>
      </label>
      {!compact && selected?.description && <p className="muted">{selected.description}</p>}
      {selected?.variants && selected.variants.length > 0 && (
        <label>
          {t("wizard.model.variant")}
          <select
            value={variant ? String(selected.variants.indexOf(variant)) : ""}
            onChange={(e) => pickVariant(e.target.value)}
          >
            {!variant && <option value="">{t("wizard.model.custom")}</option>}
            {selected.variants.map((v, i) => (
              <option key={`${v.displayName}-${i}`} value={String(i)}>
                {variantOptionLabel(selected, v, i, selected.variants!)}
              </option>
            ))}
          </select>
        </label>
      )}
      {(compact ? extras.filter(boolParam) : extras).map((def) =>
        boolParam(def) ? (
          <label key={def.id} className="choice">
            <input
              type="checkbox"
              checked={paramValue(params, def.id) === "true"}
              onChange={(e) =>
                selected && onChange(selected.id, setParam(params, def.id, e.target.checked ? "true" : "false"))
              }
            />
            {def.displayName || def.id}
          </label>
        ) : (
          <label key={def.id}>
            {def.displayName || def.id}
            <select
              value={paramValue(params, def.id) ?? def.values[0]?.value ?? ""}
              onChange={(e) => selected && onChange(selected.id, setParam(params, def.id, e.target.value))}
            >
              {def.values.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.displayName || v.value}
                </option>
              ))}
            </select>
          </label>
        ),
      )}
    </div>
  );
}
