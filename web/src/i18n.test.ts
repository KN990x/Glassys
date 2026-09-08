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
    expect(en["wizard.cred.required"].toLowerCase()).toContain("cursor-cli");
    expect(es["wizard.cred.login"].toLowerCase()).toContain("sdk");
    expect(es["wizard.cred.required"].toLowerCase()).toContain("cursor-cli");
  });
});
