import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

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
    <Label className="flex flex-col items-stretch gap-1.5 font-normal text-muted-foreground [&>span]:text-xs">
      {label}
      {children}
    </Label>
  );
}
