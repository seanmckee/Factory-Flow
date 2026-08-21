import type { InputHTMLAttributes } from "react";

/**
 * An input that reads as table text until hovered or focused. Used by the setup
 * pages, where the table itself is the edit surface. Width comes from the
 * caller via className.
 */
export default function InlineInput({
  numeric,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { numeric?: boolean }) {
  const base =
    "rounded border border-transparent bg-transparent p-1 hover:border-slate-300 focus:border-slate-300 focus:bg-white disabled:opacity-50";
  return (
    <input
      {...rest}
      className={`${base}${numeric ? " text-right tabular-nums" : ""}${
        className ? ` ${className}` : ""
      }`}
    />
  );
}
