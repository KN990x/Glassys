import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import type { RedactedConfig } from "@glassys/protocol";
import { isTheme, resolveTheme, type Theme } from "@glassys/protocol";
import { I18nProvider, isLocale, useT, type Locale } from "./i18n";
import { ApiError, api, setUnauthorizedHandler } from "./api";
import { Setup } from "./pages/Setup";
import { Login } from "./pages/Login";
import { GlassysMark } from "./components/Icon";

const Wizard = lazy(() => import("./pages/Wizard").then((m) => ({ default: m.Wizard })));
/* Chat carries the markdown renderer and most of the app. Split out, Login and Setup no longer
   download it first; it is fetched at boot alongside the auth calls, so chat does not wait. */
const loadChat = () => import("./pages/Chat");
const Chat = lazy(() => loadChat().then((m) => ({ default: m.Chat })));

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
    return isLocale(value) ? value : null;
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
  const [setupNeedsCode, setSetupNeedsCode] = useState(false);
  const [bootLocale, setBootLocale] = useState<Locale>(() => readStoredLocale() ?? readNavigatorLocale());
  const [prefersLight, setPrefersLight] = useState(readPrefersLight);

  const refresh = useCallback(async () => {
    try {
      const status = await api.status();
      if (!status.setupComplete) {
        setSetupNeedsCode(Boolean(status.setupNeedsCode));
        setGate("setup");
        return;
      }
      try {
        const me = await api.me();
        const cfg = await api.config();
        setConfig(cfg);
        setGate(me.onboarded ? "chat" : "wizard");
      } catch (err) {
        /* Only a refused session means "sign in"; a 502 from the proxy or a dropped request does not. */
        setGate(err instanceof ApiError && (err.status === 401 || err.status === 403) ? "login" : "unreachable");
      }
    } catch {
      setGate("unreachable");
    }
  }, []);

  useEffect(() => {
    void loadChat().catch(() => undefined);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setUnauthorizedHandler(() => setGate("login"));
    return () => setUnauthorizedHandler(null);
  }, []);

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
      : isLocale(config?.space.locale)
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
        {gate === "setup" && <Setup locale={bootLocale} onLocale={setBootLocale} needsCode={setupNeedsCode} onDone={() => void refresh()} />}
        {gate === "login" && <Login locale={bootLocale} onLocale={setBootLocale} onDone={() => void refresh()} />}
        {gate === "wizard" && config && (
          <Suspense fallback={<BootScreen />}>
            <Wizard config={config} onConfig={setConfig} onDone={() => void refresh()} />
          </Suspense>
        )}
        {gate === "chat" && config && (
          <Suspense fallback={<BootScreen />}>
            <Chat config={config} onConfig={setConfig} onLogout={() => void refresh()} />
          </Suspense>
        )}
      </div>
    </I18nProvider>
  );
}

function BootScreen() {
  const t = useT();
  return (
    <main className="gate" aria-busy="true">
      {/* The mark, breathing. A card with a spinner in it implied a dialog. */}
      <div className="boot">
        <span className="boot-mark">
          <GlassysMark size={40} />
        </span>
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
        <div className="brand tight">
          <GlassysMark size={22} />
          <strong>{t("app.name")}</strong>
        </div>
        <div className="panel-heading">
          <h2>{t("boot.unreachableTitle")}</h2>
          <p className="muted" role="alert">
            {t("boot.unreachable")}
          </p>
        </div>
        <button type="button" className="primary" onClick={onRetry}>
          {t("boot.retry")}
        </button>
      </div>
    </main>
  );
}
