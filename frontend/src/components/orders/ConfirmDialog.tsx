import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

type ConfirmDialogProps = {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Minimal modal - there is no dialog library here.
 *
 * No portal: ToastProvider already renders fixed-position children correctly
 * from inside the tree, and nothing in the shell creates a containing block.
 * Deliberately stays at z-50 like the toasts, and renders before them, so an
 * error toast from a failed confirm stays visible on top.
 *
 * Honest limitation: role/aria + Escape + initial focus, but no Tab focus trap.
 */
export default function ConfirmDialog({
  title,
  body,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel]);

  // plain DOM focus, no setState - keeps react-hooks/set-state-in-effect happy
  useEffect(() => {
    const previous = document.activeElement;
    cancelRef.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-lg border border-slate-300 bg-white p-6 shadow-xl"
      >
        <h2 className="text-lg font-bold">{title}</h2>
        <div className="mt-2 text-sm text-slate-600">{body}</div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            ref={cancelRef}
            onClick={onCancel}
            disabled={busy}
            className="p-2 rounded-lg bg-slate-200 text-slate-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="p-2 rounded-lg bg-red-600 text-white disabled:opacity-50"
          >
            {busy ? "Deleting…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
