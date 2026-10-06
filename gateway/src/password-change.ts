import type { ConfigPatch } from "@glassys/protocol";
import { verifyOperatorPassword } from "./auth.js";
import { HttpError } from "./errors.js";
import { attemptLogin } from "./login-limit.js";
import { loadSecrets } from "./secrets.js";

/** One lane for every password change, whoever asks: a stolen session gets the login's backoff. */
const CHANGE_LANE = "password-change";

/**
 * A new operator password needs the current one. Without that, anyone holding a session (a
 * stolen cookie, an unlocked phone) could replace the password and lock the operator out.
 */
export async function assertPasswordChangeAllowed(patch: ConfigPatch): Promise<void> {
  if (typeof patch.operatorPassword !== "string" || patch.operatorPassword.length === 0) return;
  const { operatorPasswordHash } = await loadSecrets();
  if (!operatorPasswordHash) return;
  const current = typeof patch.currentPassword === "string" ? patch.currentPassword : "";
  const result = await attemptLogin(CHANGE_LANE, async () => {
    const ok = await verifyOperatorPassword(current);
    return { ok, value: ok };
  });
  if (result === "busy") throw new HttpError(429, "too many attempts");
  if (!result) throw new HttpError(403, "current password is incorrect");
}
