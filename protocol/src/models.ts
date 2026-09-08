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

function paramsEqual(a: ModelParam[], b: ModelParam[]): boolean {
  if (a.length !== b.length) return false;
  const map = new Map(a.map((p) => [p.id, p.value]));
  return b.every((p) => map.get(p.id) === p.value);
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
  if (!fallback) return item;
  return {
    ...fallback,
    ...item,
    displayName: item.displayName || fallback.displayName,
    description: item.description ?? fallback.description,
    parameters: item.parameters?.length ? item.parameters : fallback.parameters,
    variants: item.variants?.length ? item.variants : fallback.variants,
  };
}

/** Merge a live listing with an adapter-owned fallback catalog. Empty live list → fallback. */
export function mergeModelCatalog(
  listed: ModelCatalogItem[],
  fallback: ModelCatalogItem[] = [],
  compare?: (a: ModelCatalogItem, b: ModelCatalogItem) => number,
): ModelCatalogItem[] {
  const staticById = new Map(fallback.map((m) => [m.id, m]));
  const sort = compare ?? (() => 0);
  if (!listed.length) return [...fallback].sort(sort);
  return listed
    .filter((m) => Boolean(m?.id))
    .map((m) => enrichFromStatic(m, staticById.get(m.id)))
    .sort(sort);
}
