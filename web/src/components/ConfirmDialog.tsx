import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "../i18n";
import { IconAlert } from "./Icon";

export type ConfirmRequest = {
  message: string;
  title?: string;
  confirmLabel?: string;
  destructive?: boolean;
};

type Pending = ConfirmRequest & { resolve: (value: boolean) => void };

/**
 * Replaces window.confirm. The native dialog renders the origin URL and OS
 * chrome, which breaks the illusion of an installed app on a phone.
 */
export function ConfirmDialog({
  request,
  onResolve,
}: {
  request: ConfirmRequest;
  onResolve: (value: boolean) => void;
}) {
  const t = useT();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const onResolveRef = useRef(onResolve);
  onResolveRef.current = onResolve;

  useEffect(() => {
    confirmRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onResolveRef.current(false);
        return;
      }
      if (e.key !== "Tab") return;
      const root = panelRef.current;
      if (!root) return;
      const nodes = [...root.querySelectorAll<HTMLElement>("button")].filter((el) => !el.hasAttribute("disabled"));
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div className="confirm-overlay" onClick={() => onResolve(false)}>
      <div
        className="confirm-panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
      >
        <span className={`confirm-icon${request.destructive ? " destructive" : ""}`}>
          <IconAlert size={18} />
        </span>
        <h2 id="confirm-title">{request.title || t("confirm.title")}</h2>
        <p className="muted">{request.message}</p>
        <div className="row">
          <button type="button" className="ghost" onClick={() => onResolve(false)}>
            {t("confirm.cancel")}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={request.destructive ? "danger" : "primary"}
            onClick={() => onResolve(true)}
          >
            {request.confirmLabel || t("confirm.ok")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** `const { confirm, confirmDialog } = useConfirm()`, then `await confirm({...})`. */
export function useConfirm(): { confirm: (req: ConfirmRequest) => Promise<boolean>; confirmDialog: ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback(
    (req: ConfirmRequest) => new Promise<boolean>((resolve) => setPending({ ...req, resolve })),
    [],
  );

  const confirmDialog = pending ? (
    <ConfirmDialog
      request={pending}
      onResolve={(value) => {
        pending.resolve(value);
        setPending(null);
      }}
    />
  ) : null;

  return { confirm, confirmDialog };
}
