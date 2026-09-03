import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ToastContext } from "./ToastContext";
import type { ToastAction, ToastVariant } from "./ToastContext";

type Toast = {
  id: number;
  message: string;
  variant: ToastVariant;
  action?: ToastAction;
};

const DISMISS_AFTER_MS = 3500;

/** A toast with a button has to outlive the reading of it. */
const DISMISS_WITH_ACTION_MS = 12000;

export default function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef<number[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (
      message: string,
      variant: ToastVariant = "success",
      action?: ToastAction,
    ) => {
      const id = nextId.current++;
      setToasts((prev) => [
        ...prev,
        action ? { id, message, variant, action } : { id, message, variant },
      ]);

      const timer = window.setTimeout(
        () => dismiss(id),
        action ? DISMISS_WITH_ACTION_MS : DISMISS_AFTER_MS,
      );
      timers.current.push(timer);
    },
    [dismiss],
  );

  // a toast dismissing after unmount would set state on a dead component
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            aria-live="polite"
            className={`flex items-center gap-3 rounded-lg border px-4 py-2.5 text-sm shadow-lg ${
              toast.variant === "error"
                ? "border-destructive/50 bg-destructive/15 text-destructive backdrop-blur"
                : "border-border bg-popover text-popover-foreground backdrop-blur"
            }`}
          >
            <span>{toast.message}</span>
            {toast.action && (
              <button
                className="shrink-0 rounded-md border border-current/30 px-2 py-1 text-xs font-medium hover:bg-current/10"
                onClick={() => {
                  toast.action?.onClick();
                  dismiss(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext>
  );
}
