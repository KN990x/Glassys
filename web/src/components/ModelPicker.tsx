import type { ModelCatalogItem, ModelParam, ModelParamDef } from "@glassys/protocol";
import { defaultParamsFor, matchingVariant, modelOptionLabel, variantOptionLabel } from "@glassys/protocol";
import { useT } from "../i18n";

function boolParam(def: ModelParamDef): boolean {
  const values = new Set(def.values.map((v) => v.value));
  return values.has("true") && values.has("false") && def.values.length <= 2;
}

function variantParamIds(model: ModelCatalogItem): Set<string> {
  return new Set((model.variants ?? []).flatMap((v) => v.params.map((p) => p.id)));
}

function extraDefs(model: ModelCatalogItem): ModelParamDef[] {
  const used = variantParamIds(model);
  const defs = model.parameters ?? [];
  if (!model.variants?.length) return defs;
  return defs.filter((d) => !used.has(d.id));
}

function paramValue(params: ModelParam[], id: string): string | undefined {
  return params.find((p) => p.id === id)?.value;
}

function setParam(params: ModelParam[], id: string, value: string): ModelParam[] {
  const next = params.filter((p) => p.id !== id);
  next.push({ id, value });
  return next;
}

function applyVariant(model: ModelCatalogItem, variantParams: ModelParam[], current: ModelParam[]): ModelParam[] {
  const used = variantParamIds(model);
  const extras = current.filter((p) => !used.has(p.id));
  return [...variantParams, ...extras];
}

function extraDefaults(model: ModelCatalogItem, preferred?: ModelParam[]): ModelParam[] {
  return extraDefs(model).map((d) => {
    const fromPreferred = preferred?.find((p) => p.id === d.id);
    if (fromPreferred) return fromPreferred;
    const fallback = d.values.find((v) => v.value === "false") ?? d.values[0];
    return { id: d.id, value: fallback?.value ?? "" };
  }).filter((p) => p.value);
}

function flagshipVariantParams(model: ModelCatalogItem): ModelParam[] {
  const extra = model.variants?.find(
    (v) => /extra\s*high|xhigh/i.test(v.displayName) || v.params.some((p) => p.value === "xhigh"),
  );
  return extra?.params ?? defaultParamsFor(model);
}

export function paramsForSelection(
  model: ModelCatalogItem | undefined,
  preferred?: { id: string; params: ModelParam[] },
): ModelParam[] {
  if (!model) return preferred?.params ?? [];
  const preferredForModel = preferred?.id === model.id ? preferred.params : undefined;
  const used = variantParamIds(model);
  const fromPreferred = preferredForModel?.filter((p) => used.has(p.id)) ?? [];
  const variantParams = fromPreferred.length ? fromPreferred : flagshipVariantParams(model);
  return applyVariant(model, variantParams, extraDefaults(model, preferredForModel));
}

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
