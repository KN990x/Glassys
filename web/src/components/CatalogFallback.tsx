import { useT } from "../i18n";
import { Callout } from "./Primitives";

/** Short fallback warning for live catalogs. Long SDK errors go in details, never in the composer. */
export function CatalogFallbackNotice({
  liveCatalog,
  source,
  error,
}: {
  liveCatalog?: boolean;
  source?: string;
  error?: string;
}) {
  const t = useT();
  if (source !== "fallback" || liveCatalog === false) return null;
  return (
    <>
      {/* A callout like every other warning, not a bare amber sentence. */}
      <Callout tone="warn">{t("wizard.model.fallback")}</Callout>
      {error ? (
        <details>
          <summary>{t("wizard.model.fallbackDetails")}</summary>
          <p className="muted">{error}</p>
        </details>
      ) : null}
    </>
  );
}
