import { createContext, useContext, useMemo, type ReactNode } from "react";
import en from "./locales/en.json";
import es from "./locales/es.json";

const catalogs = { en, es } as const;
export type Locale = keyof typeof catalogs;

/** Every language the PWA speaks, named in itself. Adding one means a catalog and a line here. */
export const LOCALES: ReadonlyArray<{ value: Locale; label: string }> = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
];

export function isLocale(value: unknown): value is Locale {
  return LOCALES.some((l) => l.value === value);
}

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

/** The operator-facing line for an adapter, in the PWA's language; unknown adapters keep their own. */
export function adapterDescription(t: (key: string) => string, adapter: { id: string; description?: string }): string | undefined {
  const key = `adapter.desc.${adapter.id}`;
  const line = t(key);
  return line === key ? adapter.description : line;
}
