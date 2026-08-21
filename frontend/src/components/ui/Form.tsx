import type { FormEvent, ReactNode } from "react";

/** The bordered card every create form sits in. */
export function FormCard({
  onSubmit,
  children,
}: {
  onSubmit: (event: FormEvent) => void;
  children: ReactNode;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="mt-6 flex max-w-3xl flex-col gap-4 rounded-lg border border-slate-300 bg-white p-6"
    >
      {children}
    </form>
  );
}

/** Shared by every control in a FormCard. Concatenate for per-field extras. */
export const inputClass = "border border-slate-300 rounded-lg p-2 bg-white";

/**
 * Label wrapping its own control - there is no htmlFor/id pairing anywhere in
 * this codebase, the nesting does the association. `children` is the control
 * plus any hint text below it.
 */
export function Field({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm text-slate-600">
      {label}
      {children}
    </label>
  );
}

export function SubmitButton({
  busy,
  busyLabel,
  children,
}: {
  busy: boolean;
  busyLabel: string;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="self-start bg-blue-500 text-white p-2 rounded-lg disabled:opacity-50"
    >
      {busy ? busyLabel : children}
    </button>
  );
}
