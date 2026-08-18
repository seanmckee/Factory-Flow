import { HttpError } from "./httpError.js";

/** Just the sales order fields allocation needs, so this stays testable without a DB. */
export type AllocatableSalesOrder = {
  id: number;
  partId: number;
  quantity: number;
  orderNumber: string;
};

export type PlannedAllocation = {
  salesOrderId: number;
  workOrderId: number;
  quantity: number;
};

/** Ordered quantity minus everything already allocated against it. */
export function openQuantity(
  salesOrder: AllocatableSalesOrder,
  allocatedBySalesOrderId: Map<number, number>,
): number {
  return (
    salesOrder.quantity - (allocatedBySalesOrderId.get(salesOrder.id) ?? 0)
  );
}

/**
 * Fill open demand oldest-first until the work order quantity runs out, spanning
 * as many sales orders as needed. A leftover remainder is inventory, not an error.
 *
 * `salesOrders` MUST already be ordered by id ascending: there is no createdAt
 * column anywhere in the schema, so id order is creation order.
 *
 * The caller must insert the returned rows in this order in a single insert.
 * calculateThroughput credits a finished unit to a work order's allocations in
 * allocation-id order, so preserving this order is what keeps oldest-demand-first
 * allocation aligned with oldest-demand-first revenue.
 */
export function planAutoAllocation(
  salesOrders: AllocatableSalesOrder[],
  allocatedBySalesOrderId: Map<number, number>,
  workOrderId: number,
  workOrderQuantity: number,
): PlannedAllocation[] {
  const rows: PlannedAllocation[] = [];
  let remaining = workOrderQuantity;

  for (const salesOrder of salesOrders) {
    if (remaining <= 0) break;

    // "open" = allocated less than ordered
    const open = openQuantity(salesOrder, allocatedBySalesOrderId);
    if (open <= 0) continue;

    const take = Math.min(open, remaining);
    rows.push({ salesOrderId: salesOrder.id, workOrderId, quantity: take });
    remaining -= take;
  }

  return rows;
}

/**
 * Allocate to one explicitly chosen sales order. Rejects rather than silently
 * clamping, so an over-allocation is reported instead of quietly doing something
 * other than what was asked. `requestedQuantity` defaults to as much of the work
 * order as that sales order can still absorb.
 */
export function planExplicitAllocation(
  salesOrder: AllocatableSalesOrder,
  allocatedBySalesOrderId: Map<number, number>,
  workOrderPartId: number,
  workOrderId: number,
  workOrderQuantity: number,
  requestedQuantity: number | null,
): PlannedAllocation[] {
  if (salesOrder.partId !== workOrderPartId) {
    throw new HttpError(
      400,
      `Sales order ${salesOrder.orderNumber} is for a different part`,
    );
  }

  const open = openQuantity(salesOrder, allocatedBySalesOrderId);
  if (open <= 0) {
    throw new HttpError(
      400,
      `Sales order ${salesOrder.orderNumber} is already fully allocated`,
    );
  }

  const quantity = requestedQuantity ?? Math.min(workOrderQuantity, open);

  if (quantity > workOrderQuantity) {
    throw new HttpError(
      400,
      `Cannot allocate ${quantity} units; work order quantity is ${workOrderQuantity}`,
    );
  }

  if (quantity > open) {
    throw new HttpError(
      400,
      `Cannot allocate ${quantity} to ${salesOrder.orderNumber}; only ${open} unfilled`,
    );
  }

  return [{ salesOrderId: salesOrder.id, workOrderId, quantity }];
}
