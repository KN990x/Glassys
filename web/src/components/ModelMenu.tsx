import { useState } from "react";
import type { ModelCatalogItem, ModelParam, ModelParamDef } from "@glassys/protocol";
import { matchingVariant, modelOptionLabel } from "@glassys/protocol";
import { useT } from "../i18n";
import { paramsForSelection } from "./ModelPicker";
import { PopAnchor, Popover } from "./Popover";
import { SegmentedControl } from "./SegmentedControl";
import { Switch } from "./Switch";
import { IconCheck, IconChevronDown } from "./Icon";

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

function setParam(params: ModelParam[], id: string, value: string): ModelParam[] {
  return [...params.filter((p) => p.id !== id), { id, value }];
}

function applyVariant(model: ModelCatalogItem, variantParams: ModelParam[], current: ModelParam[]): ModelParam[] {
  const used = variantParamIds(model);
  return [...variantParams, ...current.filter((p) => !used.has(p.id))];
}

/** The chip's own label: model, and the effort it is running at. */
export function modelChipLabel(model: ModelCatalogItem | undefined, params: ModelParam[], fallback: string): string {
  if (!model) return fallback;
  const variant = matchingVariant(model, params);
  const name = model.displayName || model.id;
  return variant ? `${name} · ${variant.displayName}` : name;
}

/**
 * The composer's model control. It was a native <select> with a floating
 * "Model" label, a second <select> for the variant and loose checkboxes beside
 * it — four controls in a row that had to stay under 30px tall.
 */
export function ModelMenu({
  models,
  modelId,
  params,
  onChange,
  preferred,
  adapterName,
}: {
  models: ModelCatalogItem[];
  modelId: string;
  params: ModelParam[];
  onChange: (id: string, params: ModelParam[]) => void;
  preferred?: { id: string; params: ModelParam[] };
  adapterName?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const selected = models.find((m) => m.id === modelId) ?? models.find((m) => m.id === preferred?.id) ?? models[0];
  const variants = selected?.variants ?? [];
  const variant = matchingVariant(selected, params);
  const extras = selected ? extraDefs(selected).filter(boolParam) : [];

  if (!models.length) return <p className="muted composer-hint">{t("wizard.model.empty")}</p>;

  return (
    <PopAnchor className="model-chip">
      <button
        type="button"
        className="ghost tiny chip-btn"
        aria-expanded={open}
        aria-label={t("chat.model")}
        title={[adapterName, modelChipLabel(selected, params, modelId)].filter(Boolean).join(" · ")}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="truncate">
          {selected?.displayName || selected?.id || modelId}
          {variant ? <span className="chip-variant"> · {variant.displayName}</span> : null}
        </span>
        <IconChevronDown />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} label={t("chat.model")} side="top" align="start" wide>
        <div className="pop-section">
          <p className="eyebrow">{adapterName ? `${t("chat.model")} · ${adapterName}` : t("chat.model")}</p>
          <ul className="pop-list">
            {models.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className={`ghost picker-item${m.id === selected?.id ? " current" : ""}`}
                  onClick={() => {
                    onChange(m.id, paramsForSelection(m, preferred));
                    setOpen(false);
                  }}
                >
                  <strong>{modelOptionLabel(m, models)}</strong>
                  {m.description ? <span className="muted">{m.description}</span> : null}
                  {m.id === selected?.id ? (
                    <span className="picker-check" aria-hidden="true">
                      <IconCheck />
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
        {variants.length > 0 && selected && (
          <div className="pop-section">
            <p className="eyebrow">{t("wizard.model.variant")}</p>
            <SegmentedControl
              size="sm"
              label={t("wizard.model.variant")}
              value={variant ? String(variants.indexOf(variant)) : ""}
              onChange={(next) => {
                const picked = variants[Number(next)];
                if (picked) onChange(selected.id, applyVariant(selected, picked.params, params));
              }}
              options={variants.map((v, i) => ({ value: String(i), label: v.displayName }))}
            />
          </div>
        )}
        {extras.length > 0 && selected && (
          <div className="pop-section">
            {extras.map((def) => (
              <Switch
                key={def.id}
                checked={params.find((p) => p.id === def.id)?.value === "true"}
                onChange={(next) => onChange(selected.id, setParam(params, def.id, next ? "true" : "false"))}
                label={def.displayName || def.id}
              />
            ))}
          </div>
        )}
      </Popover>
    </PopAnchor>
  );
}
