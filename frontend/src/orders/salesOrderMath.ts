import type { SalesOrder } from "../types/SalesOrder";

export function allocatedQty(salesOrder: SalesOrder): number {
  return salesOrder.allocations.reduce(
    (total, allocation) => total + allocation.quantity,
    0,
  );
}

export function remainingQty(salesOrder: SalesOrder): number {
  return salesOrder.quantity - allocatedQty(salesOrder);
}

/** Open = allocated less than ordered, i.e. still has demand to fill. */
export function isOpen(salesOrder: SalesOrder): boolean {
  return remainingQty(salesOrder) > 0;
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** formatCents(-500) would read "$-5.00"; below-cost pricing needs "-$5.00". */
export function formatSignedCents(cents: number): string {
  return cents < 0 ? `-${formatCents(-cents)}` : formatCents(cents);
}

/**
 * Dollars typed into a form to integer cents, or null for an empty or
 * non-numeric field. This file runs without strictNullChecks, so an unguarded
 * NaN would render as "$NaN" instead of failing loudly.
 *
 * The single rounding site: the preview and the submitted payload must agree.
 */
export function dollarsToCents(dollars: string): number | null {
  const parsed = Number.parseFloat(dollars);
  if (!Number.isFinite(parsed)) return null;
  // 19.99 * 100 is 1998.9999... in floating point, so round rather than truncate
  return Math.round(parsed * 100);
}

/**
 * What calculateThroughput credits for each finished, allocated unit: the sale
 * price minus the truly-variable cost. Material is the only variable cost in the
 * model today - labour and operating expense aren't modelled yet.
 */
export function throughputPerUnitCents(
  unitPriceCents: number,
  materialCostCents: number,
): number {
  return unitPriceCents - materialCostCents;
}
