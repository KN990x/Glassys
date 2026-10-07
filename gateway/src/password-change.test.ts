import { afterEach, describe, expect, it } from "vitest";
import { assertPasswordChangeAllowed } from "./password-change.js";

describe("assertPasswordChangeAllowed", () => {
  afterEach(() => {
    delete process.env.GLASSYS_OPERATOR_PASSWORD_HASH;
  });

  it("refuses a change the env-provided hash would silently override", async () => {
    process.env.GLASSYS_OPERATOR_PASSWORD_HASH = "scrypt$whatever";
    await expect(assertPasswordChangeAllowed({ operatorPassword: "new password here", currentPassword: "x" })).rejects.toMatchObject({
      status: 409,
    });
  });

  it("lets patches without a password through", async () => {
    process.env.GLASSYS_OPERATOR_PASSWORD_HASH = "scrypt$whatever";
    await expect(assertPasswordChangeAllowed({ space: { name: "x" } } as never)).resolves.toBeUndefined();
  });
});
