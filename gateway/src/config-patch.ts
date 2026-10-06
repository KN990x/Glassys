import type { ConfigPatch } from "@glassys/protocol";

/** The config sections an API/WS patch may change. */
const PATCHABLE = ["space", "onboarding", "agent", "display", "session", "prompts"] as const;
/** Fields of a patch that are not config sections but are handled separately (secrets). */
const SECRET_FIELDS = ["adapterApiKey", "cursorApiKey", "operatorPassword", "currentPassword"] as const;

/**
 * Bind, origins, and edge auth are yaml/env only — API/WS patches must not change them. Anything
 * else that is not a config section (a client echoing `secrets`, `dataDir` or `restartRequired`
 * back, a typo) is dropped too: it would otherwise be written into config.yaml.
 */
export function stripOperatorRestricted(patch: ConfigPatch): ConfigPatch {
  const out: Record<string, unknown> = {};
  for (const key of [...PATCHABLE, ...SECRET_FIELDS]) {
    if (key in patch && (patch as Record<string, unknown>)[key] !== undefined) {
      out[key] = (patch as Record<string, unknown>)[key];
    }
  }
  return out as ConfigPatch;
}
