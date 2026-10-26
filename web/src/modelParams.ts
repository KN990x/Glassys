import type { ModelCatalogItem, ModelParam, ModelParamDef } from "@glassys/protocol";
import { defaultParamsFor } from "@glassys/protocol";

/* Model parameter helpers for the composer's menu and the Settings / wizard picker. */

export function boolParam(def: ModelParamDef): boolean {
  const values = new Set(def.values.map((v) => v.value));
  return values.has("true") && values.has("false") && def.values.length <= 2;
}

function variantParamIds(model: ModelCatalogItem): Set<string> {
  return new Set((model.variants ?? []).flatMap((v) => v.params.map((p) => p.id)));
}

export function extraDefs(model: ModelCatalogItem): ModelParamDef[] {
  const used = variantParamIds(model);
  const defs = model.parameters ?? [];
  if (!model.variants?.length) return defs;
  return defs.filter((d) => !used.has(d.id));
}

export function paramValue(params: ModelParam[], id: string): string | undefined {
  return params.find((p) => p.id === id)?.value;
}

export function setParam(params: ModelParam[], id: string, value: string): ModelParam[] {
  const next = params.filter((p) => p.id !== id);
  next.push({ id, value });
  return next;
}

export function applyVariant(model: ModelCatalogItem, variantParams: ModelParam[], current: ModelParam[]): ModelParam[] {
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
