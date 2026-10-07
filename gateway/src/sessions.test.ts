import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

describe("revalidateSocket", () => {
  it("closes a socket whose session was revoked, and leaves a valid one open", async () => {
    process.env.GLASSYS_DATA_DIR = await mkdtemp(join(tmpdir(), "glassys-sess-"));
    delete process.env.GLASSYS_JWT_SECRET;
    const { signSession, revokeSessionToken } = await import("./auth.js");
    const { revalidateSocket, trackSocketSession, untrackSocket } = await import("./sessions.js");
    const fake = () => ({ send: vi.fn(), close: vi.fn(), terminate: vi.fn() });
    const ended = fake();
    const live = fake();
    const endedToken = await signSession();
    trackSocketSession(ended as never, endedToken);
    trackSocketSession(live as never, await signSession());
    await revokeSessionToken(endedToken);
    await revalidateSocket(ended as never);
    await revalidateSocket(live as never);
    expect(ended.close).toHaveBeenCalledWith(4001, "session ended");
    expect(ended.send).toHaveBeenCalledWith(expect.stringContaining("auth.error"));
    expect(live.close).not.toHaveBeenCalled();
    untrackSocket(live as never);
  });
});
