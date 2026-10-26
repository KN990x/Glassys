import { describe, expect, it } from "vitest";

describe("sealSecretEnv", () => {
  it("keeps the session secrets from processes the gateway starts", async () => {
    process.env.GLASSYS_JWT_SECRET = "sealed-jwt-secret-sealed-jwt-secret-0123";
    process.env.GLASSYS_OPERATOR_PASSWORD_HASH = "scrypt$sealed";
    const { sealSecretEnv, secretEnv, envJwtSecret } = await import("./secrets.js");
    sealSecretEnv();
    expect(process.env.GLASSYS_JWT_SECRET).toBeUndefined();
    expect(process.env.GLASSYS_OPERATOR_PASSWORD_HASH).toBeUndefined();
    expect(envJwtSecret()).toBe("sealed-jwt-secret-sealed-jwt-secret-0123");
    expect(secretEnv("GLASSYS_OPERATOR_PASSWORD_HASH")).toBe("scrypt$sealed");
    const { execFileSync } = await import("node:child_process");
    const childEnv = execFileSync(process.execPath, ["-e", "process.stdout.write(JSON.stringify(process.env))"], {
      encoding: "utf8",
    });
    expect(childEnv).not.toContain("sealed-jwt-secret");
    expect(childEnv).not.toContain("scrypt$sealed");
  });
});
