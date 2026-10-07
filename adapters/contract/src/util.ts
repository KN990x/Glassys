import { asRecord } from "./list.js";

/** A non-empty string, or undefined. Mappers read loosely typed SDK payloads through this. */
export function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** A finite number, or undefined. */
export function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function firstNum(rec: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const v = num(rec[key]);
    if (v !== undefined) return v;
  }
  return undefined;
}

const INPUT_KEYS = ["inputTokens", "input_tokens", "promptTokens", "prompt_tokens"] as const;
const OUTPUT_KEYS = ["outputTokens", "output_tokens", "completionTokens", "completion_tokens"] as const;
/**
 * Prompt tokens served from or written to the cache, where the vendor reports them apart from
 * input (Anthropic, Cursor). OpenAI-style `cached_input_tokens` is a subset of `input_tokens`
 * already and is deliberately not listed.
 */
const CACHE_KEYS = [
  ["cacheReadInputTokens", "cache_read_input_tokens", "cacheReadTokens"],
  ["cacheCreationInputTokens", "cache_creation_input_tokens", "cacheWriteTokens"],
] as const;

/**
 * Token usage from a vendor usage record, whatever its casing. Cached prompt tokens count as
 * input: leaving them out under-reports a cached conversation by an order of magnitude.
 */
export function usageFrom(raw: unknown): { inputTokens?: number; outputTokens?: number } | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  let inputTokens = firstNum(rec, INPUT_KEYS);
  for (const keys of CACHE_KEYS) {
    const cached = firstNum(rec, keys);
    if (cached !== undefined) inputTokens = (inputTokens ?? 0) + cached;
  }
  const outputTokens = firstNum(rec, OUTPUT_KEYS);
  /* A run that never reached the model (a login failure) reports zeros: nothing to show. */
  if (!inputTokens && !outputTokens) return null;
  return { inputTokens, outputTokens };
}
