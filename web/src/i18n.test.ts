import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import es from "./locales/es.json";

describe("i18n catalogs", () => {
  it("keeps en and es keys in sync", () => {
    const enKeys = Object.keys(en).sort();
    const esKeys = Object.keys(es).sort();
    expect(esKeys).toEqual(enKeys);
  });

  it("warns that any agent option starts a new thread", () => {
    for (const catalog of [en, es]) {
      const copy = catalog["settings.newThread"].toLowerCase();
      expect(copy).toContain("auto-run");
      expect(copy).toContain("acp");
    }
  });

  it("distinguishes Cursor SDK login from cursor-cli", () => {
    expect(en["wizard.cred.login"].toLowerCase()).toContain("sdk");
    expect(en["wizard.cred.required"].toLowerCase()).toContain("sdk");
    expect(en["wizard.cred.required"].toLowerCase()).toContain("cli");
    expect(es["wizard.cred.login"].toLowerCase()).toContain("sdk");
    expect(es["wizard.cred.required"].toLowerCase()).toContain("cli");
  });
});

describe("templateTitle", () => {
  it("translates a stock title and keeps one the operator renamed", async () => {
    const { templateTitle } = await import("./i18n");
    const t = (key: string) => (key === "prompt.status" ? "Estado del host" : key);
    expect(templateTitle(t, { id: "status", title: "Host status" })).toBe("Estado del host");
    expect(templateTitle(t, { id: "status", title: "Check web-01" })).toBe("Check web-01");
    expect(templateTitle(t, { id: "tpl-1a2b3c4d", title: "Rotate logs" })).toBe("Rotate logs");
  });
});
