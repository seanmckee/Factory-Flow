import type { ReactNode } from "react";

/**
 * Structural pieces for the list tables, carrying the shared classes so five
 * pages stop repeating them. Deliberately not a data-driven <Table columns={}>:
 * every table here has conditional cell colouring, computed values and a
 * bespoke last column, and a column config fights all three.
 */

export function Table({
  children,
  /** false when the table already sits inside a bordered card, e.g. DemandPanel. */
  framed = true,
}: {
  children: ReactNode;
  framed?: boolean;
}) {
  return (
    <div
      className={
        framed
          ? "overflow-x-auto rounded-lg border border-slate-300 bg-white"
          : "overflow-x-auto"
      }
    >
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

/** Renders the header row itself, so callers pass <Th>s directly. */
export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="bg-slate-100 text-left text-slate-600">
      <tr>{children}</tr>
    </thead>
  );
}

export function Th({
  children,
  numeric,
}: {
  children?: ReactNode;
  numeric?: boolean;
}) {
  return <th className={numeric ? "p-2 text-right" : "p-2"}>{children}</th>;
}

export function Tr({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <tr className={`border-t border-slate-200${className ? ` ${className}` : ""}`}>
      {children}
    </tr>
  );
}

/**
 * `numeric` is right-aligned and tabular. Cells that are right-aligned but hold
 * a control rather than a number pass className="text-right" instead, so they
 * don't pick up tabular-nums.
 */
export function Td({
  children,
  numeric,
  className,
  colSpan,
}: {
  children?: ReactNode;
  numeric?: boolean;
  className?: string;
  colSpan?: number;
}) {
  const base = numeric ? "p-2 text-right tabular-nums" : "p-2";
  return (
    <td className={className ? `${base} ${className}` : base} colSpan={colSpan}>
      {children}
    </td>
  );
}
