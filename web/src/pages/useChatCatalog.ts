import { useCallback, useEffect, useRef, useState } from "react";
import type { AdapterPublicInfo, ModelCatalogItem, ModelListSource } from "@glassys/protocol";
import { api } from "../api";
import { useT } from "../i18n";

/**
 * The adapters and the configured adapter's model catalog, for the chat. Both are asked again when
 * the adapter or the workspace changes (Claude lists models per workspace).
 */
export function useChatCatalog(adapter: string, cwd: string) {
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;
  const [models, setModels] = useState<ModelCatalogItem[]>([]);
  /** Until the first catalogue answer, an empty list means "not yet", not "none". */
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [modelSource, setModelSource] = useState<ModelListSource>("live");
  const [catalogError, setCatalogError] = useState("");
  const [adapters, setAdapters] = useState<AdapterPublicInfo[]>([]);
  const [adaptersError, setAdaptersError] = useState("");

  /* Only the latest ask may land: after an adapter switch, a slow reply for the old one used to. */
  const modelsAsk = useRef(0);
  const loadModels = useCallback(async (id: string) => {
    const ask = ++modelsAsk.current;
    setModelsLoaded(false);
    try {
      const r = await api.models(id);
      if (ask !== modelsAsk.current) return;
      setModels(r.models);
      setModelSource(r.source);
      setCatalogError(r.error || "");
    } catch (err) {
      if (ask !== modelsAsk.current) return;
      setModels([]);
      setModelSource("fallback");
      setCatalogError(err instanceof Error ? err.message : "");
    } finally {
      if (ask === modelsAsk.current) setModelsLoaded(true);
    }
  }, []);

  /* tRef, not t: a language preview in Settings must not refetch everything below. */
  const loadAdapters = useCallback(() => {
    setAdaptersError("");
    api
      .adapters()
      .then((r) => setAdapters(r.adapters))
      .catch((err) => {
        setAdapters([]);
        setAdaptersError(err instanceof Error ? err.message : tRef.current("wizard.adapters.failed"));
      });
  }, []);

  useEffect(() => {
    void loadModels(adapter);
    loadAdapters();
  }, [loadModels, loadAdapters, adapter, cwd]);

  return { models, modelsLoaded, modelSource, catalogError, adapters, adaptersError, loadAdapters };
}
