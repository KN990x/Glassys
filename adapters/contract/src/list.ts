export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Accept a raw SDK/CLI catalog: array, or { models | items | data }. */
export function extractListedModels(listed: unknown): unknown[] {
  if (Array.isArray(listed)) return listed;
  const rec = asRecord(listed);
  if (!rec) return [];
  for (const key of ["models", "items", "data"]) {
    const v = rec[key];
    if (Array.isArray(v)) return v;
  }
  return [];
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}
