import {
  mergeModelCatalog,
  optionBool,
  optionStringArray,
  type AgentConfig,
  type ModelCatalogItem,
  type ModelListResponse,
  type ModelParam,
} from "@glassys/protocol";
import { asRecord, extractListedModels } from "@glassys/adapter-contract";
import type { AdapterModel } from "@glassys/adapter-contract";

export const CURSOR_FLAGSHIP_MODEL_ID = "grok-4.6";

export const CURSOR_STATIC_CATALOG: ModelCatalogItem[] = [
  {
    id: "grok-4.6",
    displayName: "Grok 4.6",
    description: "Cursor flagship. Effort: low / medium / high / extra high.",
    parameters: [
      {
        id: "effort",
        displayName: "Effort",
        values: [
          { value: "low", displayName: "Low" },
          { value: "medium", displayName: "Medium" },
          { value: "high", displayName: "High" },
          { value: "xhigh", displayName: "Extra high" },
        ],
      },
      {
        id: "fast",
        displayName: "Fast",
        values: [
          { value: "false", displayName: "Standard" },
          { value: "true", displayName: "Fast" },
        ],
      },
    ],
    variants: [
      { displayName: "Extra high", params: [{ id: "effort", value: "xhigh" }], isDefault: true },
      { displayName: "High", params: [{ id: "effort", value: "high" }] },
      { displayName: "Medium", params: [{ id: "effort", value: "medium" }] },
      { displayName: "Low", params: [{ id: "effort", value: "low" }] },
    ],
  },
  {
    id: "composer-2.5",
    displayName: "Composer 2.5",
    parameters: [
      {
        id: "fast",
        displayName: "Fast",
        values: [
          { value: "false", displayName: "Standard" },
          { value: "true", displayName: "Fast" },
        ],
      },
    ],
  },
  { id: "auto", displayName: "Auto" },
];

export function cursorParamsForFlagship(model: ModelCatalogItem): ModelParam[] {
  const extra = model.variants?.find(
    (v) => /extra\s*high|xhigh/i.test(v.displayName) || v.params.some((p) => p.value === "xhigh"),
  );
  if (extra) return extra.params;

  const effort = model.parameters?.find((p) => p.id === "effort" || /effort|reasoning/i.test(p.id));
  const xhigh = effort?.values.find((v) => v.value === "xhigh");
  if (effort && xhigh) return [{ id: effort.id, value: xhigh.value }];

  const namedDefault = model.variants?.find((v) => v.isDefault);
  if (namedDefault) return namedDefault.params;
  return [];
}

export function cursorSort(a: ModelCatalogItem, b: ModelCatalogItem): number {
  if (a.id === CURSOR_FLAGSHIP_MODEL_ID) return -1;
  if (b.id === CURSOR_FLAGSHIP_MODEL_ID) return 1;
  const aFlag = a.id.startsWith("grok-4.6") || /grok[- ]?4\.6/i.test(a.displayName);
  const bFlag = b.id.startsWith("grok-4.6") || /grok[- ]?4\.6/i.test(b.displayName);
  if (aFlag && !bFlag) return -1;
  if (bFlag && !aFlag) return 1;
  return 0;
}

export function mapSdkModel(item: unknown): AdapterModel | null {
  if (typeof item === "string") return { id: item, displayName: item };
  const rec = asRecord(item);
  if (!rec || typeof rec.id !== "string") return null;
  const parameters = Array.isArray(rec.parameters)
    ? rec.parameters.flatMap((p) => {
        const pr = asRecord(p);
        if (!pr || typeof pr.id !== "string" || !Array.isArray(pr.values)) return [];
        return [
          {
            id: pr.id,
            displayName: typeof pr.displayName === "string" ? pr.displayName : undefined,
            values: pr.values.flatMap((v) => {
              if (typeof v === "string") return [{ value: v }];
              const vr = asRecord(v);
              if (!vr || typeof vr.value !== "string") return [];
              return [{ value: vr.value, displayName: typeof vr.displayName === "string" ? vr.displayName : undefined }];
            }),
          },
        ];
      })
    : undefined;
  const variants = Array.isArray(rec.variants)
    ? rec.variants.flatMap((v) => {
        const vr = asRecord(v);
        if (!vr || typeof vr.displayName !== "string") return [];
        const params = Array.isArray(vr.params)
          ? vr.params.flatMap((p) => {
              const pr = asRecord(p);
              if (!pr || typeof pr.id !== "string" || typeof pr.value !== "string") return [];
              return [{ id: pr.id, value: pr.value }];
            })
          : [];
        return [
          {
            displayName: vr.displayName,
            description: typeof vr.description === "string" ? vr.description : undefined,
            isDefault: vr.isDefault === true,
            params,
          },
        ];
      })
    : undefined;
  return {
    id: rec.id,
    displayName: typeof rec.displayName === "string" ? rec.displayName : rec.id,
    description: typeof rec.description === "string" ? rec.description : undefined,
    parameters,
    variants,
  };
}

export function parseCursorModelList(listed: unknown): AdapterModel[] {
  const models: AdapterModel[] = [];
  for (const item of extractListedModels(listed)) {
    const mapped = mapSdkModel(item);
    if (mapped) models.push(mapped);
  }
  return models;
}

export function cursorCatalogFromListed(listed: unknown): ModelListResponse {
  const models = parseCursorModelList(listed);
  if (!models.length) {
    return {
      models: mergeModelCatalog([], CURSOR_STATIC_CATALOG, cursorSort),
      source: "fallback",
      error: "Cursor.models.list returned no models",
    };
  }
  return {
    models: mergeModelCatalog(models, CURSOR_STATIC_CATALOG, cursorSort),
    source: "live",
  };
}

export function cursorFallbackCatalog(error: string): ModelListResponse {
  return {
    models: mergeModelCatalog([], CURSOR_STATIC_CATALOG, cursorSort),
    source: "fallback",
    error,
  };
}

export const CURSOR_DEFAULT_MODEL = {
  id: CURSOR_FLAGSHIP_MODEL_ID,
  params: [{ id: "effort", value: "xhigh" }] as ModelParam[],
};

/** Empty / Composer-default configs become Grok 4.6 Extra high. Explicit params are kept. */
export function normalizeCursorConfig(agent: AgentConfig): AgentConfig {
  const next: AgentConfig = {
    ...agent,
    options: {
      settingSources: optionStringArray(agent.options, "settingSources", ["project", "user"]),
      sandbox: optionBool(agent.options, "sandbox", false),
      autoRun: optionBool(agent.options, "autoRun", true),
      ...agent.options,
    },
  };
  const hadParams = Array.isArray(agent.modelParams) && agent.modelParams.length > 0;
  if (!next.model || next.model === "composer-2.5") {
    const grok = CURSOR_STATIC_CATALOG.find((m) => m.id === CURSOR_FLAGSHIP_MODEL_ID) ?? CURSOR_STATIC_CATALOG[0];
    next.model = CURSOR_FLAGSHIP_MODEL_ID;
    if (!hadParams) next.modelParams = cursorParamsForFlagship(grok);
  } else if ((next.model === CURSOR_FLAGSHIP_MODEL_ID || next.model.startsWith("grok-4.6")) && !hadParams) {
    const grok = CURSOR_STATIC_CATALOG.find((m) => m.id === CURSOR_FLAGSHIP_MODEL_ID) ?? CURSOR_STATIC_CATALOG[0];
    next.modelParams = cursorParamsForFlagship(grok);
  }
  return next;
}
