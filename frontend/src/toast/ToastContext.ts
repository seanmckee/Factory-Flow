import { createContext, useContext } from "react";

// a union rather than an enum - erasableSyntaxOnly bans enums
export type ToastVariant = "success" | "error";

/**
 * An optional button on the toast, for an error the user can actually do
 * something about — the 409 from an advance blocked by a lock a dead process
 * left behind, whose only other cure is curl.
 */
export type ToastAction = {
  label: string;
  onClick: () => void;
};

export type ToastContextValue = {
  showToast: (
    message: string,
    variant?: ToastVariant,
    action?: ToastAction,
  ) => void;
};

export const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) {
    throw new Error("useToast must be used inside a ToastProvider");
  }
  return value;
}
