import { useCallback, useEffect, useState } from "react";
import type { RedactedConfig } from "@glassys/protocol";
import { isTheme, resolveTheme, type Theme } from "@glassys/protocol";
import { I18nProvider, useT, type Locale } from "./i18n";
import { api, getToken } from "./api";
import { Setup } from "./pages/Setup";
import { Login } from "./pages/Login";
import { Wizard } from "./pages/Wizard";
import { Chat } from "./pages/Chat";

type Gate = "boot" | "unreachable" | "setup" | "login" | "wizard" | "chat";
type ResolvedTheme = "dark" | "light";

const THEME_KEY = "glassys_theme";
const LOCALE_KEY = "glassys_locale";
const THEME_COLOR: Record<ResolvedTheme, string> = { dark: "#0a0a0a", light: "#fafafa" };

function readStoredTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

function readStoredLocale(): Locale | null {
  try {
    const value = localStorage.getItem(LOCALE_KEY);
    return value === "es" || value === "en" ? value : null;
  } catch {
    return null;
  }
}

function readNavigatorLocale(): Locale {
  try {
    const lang = navigator.language.toLowerCase();
    if (lang.startsWith("es")) return "es";
  } catch {
    /* ignore */
  }
  return "en";
}

function readPrefersLight(): boolean {
  try {
    if (typeof globalThis.matchMedia === "function") {
      return globalThis.matchMedia("(prefers-color-scheme: light)").matches;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function applyDocumentTheme(resolved: ResolvedTheme, stored: Theme) {
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[resolved]);
  try {
    localStorage.setItem(THEME_KEY, stored);
  } catch {
    /* private mode / quota */
  }
}

export function App() {
  const [gate, setGate] = useState<Gate>("boot");
  const [config, setConfig] = useState<RedactedConfig | null>(null);
  const [bootLocale, setBootLocale] = useState<Locale>(() => readStoredLocale() ?? readNavigatorLocale());
  const [prefersLight, setPrefersLight] = useState(readPrefersLight);

  const refresh = useCallback(async () => {
    try {
      const status = await api.status();
      if (!status.setupComplete) {
        setGate("setup");
        return;
      }
      if (!getToken()) {
        try {
          await api.me();
        } catch {
          setGate("login");
          return;
        }
      }
      try {
        const me = await api.me();
        const cfg = await api.config();
        setConfig(cfg);
        setGate(me.onboarded ? "chat" : "wizard");
      } catch {
        if (getToken()) {
          try {
            setConfig(await api.config());
          } catch {
            /* invalid session */
          }
        }
        setGate("login");
      }
    } catch {
      setGate("unreachable");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (typeof globalThis.matchMedia !== "function") return;
    const mq = globalThis.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => setPrefersLight(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const locale: Locale =
    gate === "setup" || gate === "login" || gate === "boot" || gate === "unreachable"
      ? bootLocale
      : config?.space.locale === "es" || config?.space.locale === "en"
        ? config.space.locale
        : bootLocale;
  const themePref: Theme =
    config && isTheme(config.space.theme) ? config.space.theme : (readStoredTheme() ?? "dark");
  const resolvedTheme = resolveTheme(themePref, prefersLight);

  useEffect(() => {
    applyDocumentTheme(resolvedTheme, themePref);
  }, [resolvedTheme, themePref]);

  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      localStorage.setItem(LOCALE_KEY, locale);
    } catch {
      /* private mode / quota */
    }
  }, [locale]);

  return (
    <I18nProvider locale={locale}>
      <div className="app">
        {gate === "boot" && <BootScreen />}
        {gate === "unreachable" && (
          <Unreachable onRetry={() => { setGate("boot"); void refresh(); }} />
        )}
        {gate === "setup" && <Setup locale={bootLocale} onLocale={setBootLocale} onDone={() => void refresh()} />}
        {gate === "login" && <Login locale={bootLocale} onLocale={setBootLocale} onDone={() => void refresh()} />}
        {gate === "wizard" && config && (
          <Wizard config={config} onConfig={setConfig} onDone={() => void refresh()} />
        )}
        {gate === "chat" && config && (
          <Chat config={config} onConfig={setConfig} onLogout={() => void refresh()} />
        )}
      </div>
    </I18nProvider>
  );
}

function BootScreen() {
  const t = useT();
  return (
    <main className="gate" aria-busy="true">
      <div className="panel stack boot-panel">
        <div className="spinner" aria-hidden="true" />
        <p className="muted">{t("status.connecting")}</p>
      </div>
    </main>
  );
}

function Unreachable({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <main className="gate">
      <div className="panel">
        <h1>{t("app.name")}</h1>
        <p className="muted" role="alert">
          {t("boot.unreachable")}
        </p>
        <button type="button" className="primary" onClick={onRetry}>
          {t("boot.retry")}
        </button>
      </div>
    </main>
  );
}
