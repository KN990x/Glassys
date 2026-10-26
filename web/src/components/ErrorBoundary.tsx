import { Component, type ErrorInfo, type ReactNode } from "react";
import { useT } from "../i18n";
import { GlassysMark, IconError } from "./Icon";

type Props = { children: ReactNode; fallback: (reset: () => void) => ReactNode; label: string };

/**
 * Keeps one render error (a markdown edge case, a tool card) from unmounting the whole app and
 * leaving a blank screen.
 */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[glassys] ${this.props.label} failed to render`, error, info.componentStack);
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback(() => this.setState({ failed: false })) : this.props.children;
  }
}

/** The whole screen failed: say so and offer a reload, which also picks up new assets. */
export function CrashScreen() {
  const t = useT();
  return (
    <main className="gate">
      <div className="panel">
        <div className="brand tight">
          <GlassysMark size={22} />
          <strong>{t("app.name")}</strong>
        </div>
        <div className="panel-heading">
          <h2>{t("crash.title")}</h2>
          <p className="muted" role="alert">
            {t("crash.body")}
          </p>
        </div>
        <button type="button" className="primary" onClick={() => window.location.reload()}>
          {t("crash.reload")}
        </button>
      </div>
    </main>
  );
}

/** One transcript row failed: the rest of the conversation stays readable. */
export function CrashedRow() {
  const t = useT();
  return (
    <p className="banner error" role="status">
      <span className="banner-icon" aria-hidden="true">
        <IconError />
      </span>
      {t("crash.row")}
    </p>
  );
}
