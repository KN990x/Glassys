import { useCallback, useEffect, useState } from "react";
import type { RedactedConfig } from "@glassys/protocol";
import { I18nProvider, useT, type Locale } from "./i18n";
import { api, getToken } from "./api";
import { Setup } from "./pages/Setup";
import { Login } from "./pages/Login";
import { Wizard } from "./pages/Wizard";
import { Chat } from "./pages/Chat";

type Gate = "boot" | "unreachable" | "setup" | "login" | "wizard" | "chat";
type Theme = "dark" | "light";

const THEME_KEY = "glassys_theme";
const LOCALE_KEY = "glassys_locale";
const THEME_COLOR: Record<Theme, string> = { dark: "#0a0a0a", light: "#fafafa" };

function readStoredTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : null;
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

function applyDocumentTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private mode / quota */
  }
}

export function App() {
  const [gate, setGate] = useState<Gate>("boot");
  const [config, setConfig] = useState<RedactedConfig | null>(null);

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

  const locale: Locale =
    config?.space.locale === "es" || config?.space.locale === "en"
      ? config.space.locale
      : (readStoredLocale() ?? readNavigatorLocale());
  const theme: Theme =
    config?.space.theme === "light" || config?.space.theme === "dark"
      ? config.space.theme
      : (readStoredTheme() ?? "dark");

  useEffect(() => {
    applyDocumentTheme(theme);
  }, [theme]);

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
        {gate === "boot" && <main className="gate"><p className="muted">Glassys</p></main>}
        {gate === "unreachable" && (
          <Unreachable onRetry={() => { setGate("boot"); void refresh(); }} />
        )}
        {gate === "setup" && <Setup onDone={() => void refresh()} />}
        {gate === "login" && <Login onDone={() => void refresh()} />}
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
