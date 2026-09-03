import type { ReactNode } from "react";

/**
 * The fixed header every page starts with: title and description on the left,
 * actions (usually the "New …" dialog trigger) on the right. Pages own the
 * viewport — this stays put while the region below it scrolls.
 */
export default function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <header className="flex shrink-0 items-start justify-between gap-4 pb-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </header>
  );
}
