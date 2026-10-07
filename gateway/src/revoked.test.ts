import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("revoked sessions past the cap", () => {
  it("ends every session rather than letting an evicted revocation come back", async () => {
    process.env.GLASSYS_DATA_DIR = await mkdtemp(join(tmpdir(), "glassys-revoked-"));
    delete process.env.GLASSYS_JWT_SECRET;
    const { loadSecrets } = await import("./secrets.js");
    const { signSession, verifySession, revokeSessionToken } = await import("./auth.js");
    const { MAX_REVOKED, isSessionRevoked, revokeSession } = await import("./revoked.js");
    const before = (await loadSecrets()).jwtEpoch ?? 0;
    const first = await signSession();
    await revokeSessionToken(first);
    const exp = Math.floor(Date.now() / 1000) + 3600;
    for (let i = 0; i < MAX_REVOKED; i++) await revokeSession(`jti-${i}`, exp);
    expect((await loadSecrets()).jwtEpoch).toBe(before + 1);
    /* The first token's revocation is gone from the list, and it still does not verify. */
    expect(await verifySession(first)).toBe(false);
    expect(await isSessionRevoked("jti-0")).toBe(false);
    expect(await verifySession(await signSession())).toBe(true);
  }, 30_000);
});
