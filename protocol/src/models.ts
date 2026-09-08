export interface ModelParam {
  id: string;
  value: string;
}

export interface ModelParamValue {
  value: string;
  displayName?: string;
}

export interface ModelParamDef {
  id: string;
  displayName?: string;
  values: ModelParamValue[];
}

export interface ModelVariant {
  displayName: string;
  description?: string;
  isDefault?: boolean;
  params: ModelParam[];
}

export interface ModelCatalogItem {
  id: string;
  displayName: string;
  description?: string;
  parameters?: ModelParamDef[];
  variants?: ModelVariant[];
}

export type ModelListSource = "live" | "fallback";

export interface ModelListResponse {
  models: ModelCatalogItem[];
  source: ModelListSource;
  error?: string;
}

const KNOWN_VALUE_LABELS: Record<string, string> = {
  xhigh: "Extra high",
};

function paramsEqual(a: ModelParam[], b: ModelParam[]): boolean {
  if (a.length !== b.length) return false;
  const map = new Map(a.map((p) => [p.id, p.value]));
  return b.every((p) => map.get(p.id) === p.value);
}

function titleCaseValue(value: string): string {
  if (KNOWN_VALUE_LABELS[value]) return KNOWN_VALUE_LABELS[value];
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function paramValueLabel(def: ModelParamDef | undefined, value: string): string {
  const named = def?.values.find((v) => v.value === value)?.displayName;
  if (named) return named;
  return titleCaseValue(value);
}

export function labelFromParams(params: ModelParam[], parameters?: ModelParamDef[]): string {
  return params
    .map((p) => {
      if (p.value === "false") return "";
      const def = parameters?.find((d) => d.id === p.id);
      if (p.value === "true") return def?.displayName || titleCaseValue(p.id);
      return paramValueLabel(def, p.value);
    })
    .filter(Boolean)
    .join(" · ");
}

function isBoolDef(def: ModelParamDef): boolean {
  const values = new Set(def.values.map((v) => v.value));
  return values.has("true") && values.has("false") && def.values.length <= 2;
}

function isBoolParamId(id: string, values: Set<string>, parameters?: ModelParamDef[]): boolean {
  const def = parameters?.find((d) => d.id === id);
  if (def) return isBoolDef(def);
  return values.has("true") && values.has("false") && values.size <= 2;
}

export function variantsHaveUsefulNames(variants: ModelVariant[], modelName: string): boolean {
  if (!variants.length) return false;
  const names = variants.map((v) => v.displayName.trim());
  if (new Set(names).size < variants.length) return false;
  if (names.every((n) => n === modelName.trim())) return false;
  return true;
}

function uniqueParamKey(params: ModelParam[]): string {
  return [...params]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p) => `${p.id}=${p.value}`)
    .join("|");
}

function collapseBooleanAxes(item: ModelCatalogItem): ModelCatalogItem {
  const variants = item.variants;
  if (!variants?.length) return item;

  const ids = [...new Set(variants.flatMap((v) => v.params.map((p) => p.id)))];
  if (ids.length < 2) return item;

  const valuesById = new Map<string, Set<string>>();
  for (const id of ids) valuesById.set(id, new Set());
  for (const v of variants) {
    const have = new Set(v.params.map((p) => p.id));
    if (have.size !== ids.length || ids.some((id) => !have.has(id))) return item;
    for (const p of v.params) valuesById.get(p.id)?.add(p.value);
  }

  const product = ids.reduce((acc, id) => acc * (valuesById.get(id)?.size ?? 1), 1);
  if (product !== variants.length) return item;

  const boolIds = new Set(ids.filter((id) => isBoolParamId(id, valuesById.get(id)!, item.parameters)));
  if (!boolIds.size) return item;
  const axisIds = ids.filter((id) => !boolIds.has(id));
  if (!axisIds.length) return { ...item, variants: undefined };

  const collapsed: ModelVariant[] = [];
  const seen = new Map<string, ModelVariant>();
  for (const v of variants) {
    const axisParams = v.params.filter((p) => !boolIds.has(p.id));
    const key = uniqueParamKey(axisParams);
    const existing = seen.get(key);
    if (existing) {
      if (v.isDefault) existing.isDefault = true;
      continue;
    }
    const next: ModelVariant = {
      displayName: labelFromParams(axisParams, item.parameters) || v.displayName,
      description: v.description,
      isDefault: v.isDefault,
      params: axisParams,
    };
    seen.set(key, next);
    collapsed.push(next);
  }
  return { ...item, variants: collapsed };
}

function relabelGenericVariants(item: ModelCatalogItem): ModelCatalogItem {
  const variants = item.variants;
  if (!variants?.length) return item;
  if (variantsHaveUsefulNames(variants, item.displayName)) return item;
  return {
    ...item,
    variants: variants.map((v) => {
      const label = labelFromParams(v.params, item.parameters);
      return { ...v, displayName: label || v.displayName };
    }),
  };
}

/** Collapse cartesian bools, recover fallback labels, and synthesize names when the live list repeats the model title. */
export function normalizeCatalogItem(item: ModelCatalogItem, fallback?: ModelCatalogItem): ModelCatalogItem {
  let next = collapseBooleanAxes(item);
  const fallbackVariants = fallback?.variants;
  if (
    (!next.variants?.length || !variantsHaveUsefulNames(next.variants, next.displayName)) &&
    fallbackVariants?.length &&
    variantsHaveUsefulNames(fallbackVariants, fallback?.displayName ?? item.displayName)
  ) {
    next = { ...next, variants: fallbackVariants };
  }
  next = relabelGenericVariants(next);
  if (next.variants?.length && !variantsHaveUsefulNames(next.variants, next.displayName)) {
    return { ...next, variants: undefined };
  }
  return next;
}

export function variantOptionLabel(
  model: ModelCatalogItem,
  variant: ModelVariant,
  index: number,
  siblings: ModelVariant[],
): string {
  const raw = variant.displayName.trim();
  const dupes = siblings.filter((v) => v.displayName.trim() === raw).length > 1;
  const sameAsModel = raw === model.displayName.trim();
  if (!dupes && !sameAsModel) return raw;
  const synthesized = labelFromParams(variant.params, model.parameters);
  if (synthesized && synthesized !== model.displayName.trim()) return synthesized;
  return `${raw} (${index + 1})`;
}

export function modelOptionLabel(model: ModelCatalogItem, catalog: ModelCatalogItem[]): string {
  const clash = catalog.filter((m) => m.displayName === model.displayName).length > 1;
  if (!clash) return model.displayName;
  return `${model.displayName} (${model.id})`;
}

/** Default params: named variant, else empty. Adapters may overlay their own flagship params. */
export function defaultParamsFor(model: ModelCatalogItem | undefined): ModelParam[] {
  if (!model) return [];
  const namedDefault = model.variants?.find((v) => v.isDefault);
  if (namedDefault) return namedDefault.params;
  return [];
}

export function pickDefaultSelection(
  models: ModelCatalogItem[],
  preferredId?: string,
): { id: string; params: ModelParam[] } {
  if (!models.length) return { id: preferredId ?? "", params: [] };
  const preferred = preferredId
    ? models.find((m) => m.id === preferredId) || models.find((m) => m.id.startsWith(preferredId))
    : undefined;
  const model = preferred ?? models[0];
  return { id: model.id, params: defaultParamsFor(model) };
}

export function matchingVariant(model: ModelCatalogItem | undefined, params: ModelParam[]): ModelVariant | undefined {
  if (!model?.variants?.length) return undefined;
  const exact = model.variants.find((v) => paramsEqual(v.params, params));
  if (exact) return exact;
  return model.variants.find((v) =>
    v.params.every((p) => params.some((q) => q.id === p.id && q.value === p.value)),
  );
}

function enrichFromStatic(item: ModelCatalogItem, fallback?: ModelCatalogItem): ModelCatalogItem {
  if (!fallback) return normalizeCatalogItem(item);
  return normalizeCatalogItem(
    {
      ...fallback,
      ...item,
      displayName: item.displayName || fallback.displayName,
      description: item.description ?? fallback.description,
      parameters: item.parameters?.length ? item.parameters : fallback.parameters,
      variants: item.variants?.length ? item.variants : fallback.variants,
    },
    fallback,
  );
}

/** Merge a live listing with an adapter-owned fallback catalog. Empty live list → fallback. */
export function mergeModelCatalog(
  listed: ModelCatalogItem[],
  fallback: ModelCatalogItem[] = [],
  compare?: (a: ModelCatalogItem, b: ModelCatalogItem) => number,
): ModelCatalogItem[] {
  const staticById = new Map(fallback.map((m) => [m.id, m]));
  const sort = compare ?? (() => 0);
  if (!listed.length) return fallback.map((m) => normalizeCatalogItem(m)).sort(sort);
  return listed
    .filter((m) => Boolean(m?.id))
    .map((m) => enrichFromStatic(m, staticById.get(m.id)))
    .sort(sort);
}
