import { createContext, useContext, type ReactNode } from "react";
import en from "./locales/en.json";
import es from "./locales/es.json";

const catalogs = { en, es } as const;
export type Locale = keyof typeof catalogs;

const I18nContext = createContext<{
  locale: Locale;
  t: (key: string) => string;
}>({ locale: "en", t: (k) => k });

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const dict = catalogs[locale] ?? catalogs.en;
  const t = (key: string) => (dict as Record<string, string>)[key] ?? (en as Record<string, string>)[key] ?? key;
  return <I18nContext.Provider value={{ locale, t }}>{children}</I18nContext.Provider>;
}

export function useT(): (key: string) => string {
  return useContext(I18nContext).t;
}
