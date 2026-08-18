import { createContext, useContext } from "react";

// a union rather than an enum - erasableSyntaxOnly bans enums
export type ToastVariant = "success" | "error";

export type ToastContextValue = {
  showToast: (message: string, variant?: ToastVariant) => void;
};

export const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) {
    throw new Error("useToast must be used inside a ToastProvider");
  }
  return value;
}
