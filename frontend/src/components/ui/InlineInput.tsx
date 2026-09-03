import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

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
  return (
    <input
      {...rest}
      className={cn(
        "rounded-md border border-transparent bg-transparent p-1 transition-colors hover:border-input focus:border-input focus:bg-background focus:outline-none disabled:opacity-50",
        numeric && "text-right tabular-nums",
        className,
      )}
    />
  );
}
