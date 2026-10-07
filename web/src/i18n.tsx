import { createContext, useContext, useMemo, type ReactNode } from "react";
import en from "./locales/en.json";
import es from "./locales/es.json";

const catalogs = { en, es } as const;
export type Locale = keyof typeof catalogs;

const I18nContext = createContext<{
  locale: Locale;
  t: (key: string) => string;
}>({ locale: "en", t: (k) => k });

/**
 * `t` (and the context value) keep their identity until the locale changes. A new `t` on every
 * App render re-ran every effect that lists it: each reconnect refetched models, adapters,
 * threads and workspaces, reloaded Logs and restarted the SDK login poll.
 */
export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(() => {
    const dict = (catalogs[locale] ?? catalogs.en) as Record<string, string>;
    const t = (key: string) => dict[key] ?? (en as Record<string, string>)[key] ?? key;
    return { locale, t };
  }, [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): (key: string) => string {
  return useContext(I18nContext).t;
}
