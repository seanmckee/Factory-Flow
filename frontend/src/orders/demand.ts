import { remainingQty } from "./salesOrderMath";
import type { SalesOrder } from "../types/SalesOrder";
import type { WorkOrder } from "../types/WorkOrder";

export type OpenDemandOrder = {
  id: number;
  orderNumber: string;
  remaining: number;
  unitPriceCents: number;
};

export type PartDemand = {
  partId: number;
  /** Ordered but not yet covered by any allocation. */
  openDemandUnits: number;
  /** Planned work order quantity that isn't allocated to anything yet. */
  uncommittedSupplyUnits: number;
  /** Open demand the existing uncommitted supply can't cover. */
  netToMakeUnits: number;
  openOrders: OpenDemandOrder[];
};

/**
 * What still needs making, per part.
 *
 * Demand is "open" when a sales order has been allocated less than it ordered,
 * so existing work orders are already netted off - creating a work order writes
 * allocations, which is what closes the gap.
 *
 * Uncommitted supply is the other half: a work order can be built larger than
 * the demand it was allocated against, and that surplus is inventory nobody has
 * claimed. It can absorb new demand without producing anything more, so the net
 * figure subtracts it.
 *
 * Returns only parts with open demand, most urgent first.
 */
export function summarizeDemand(
  salesOrders: SalesOrder[],
  workOrders: WorkOrder[],
): PartDemand[] {
  const byPart = new Map<number, PartDemand>();

  const forPart = (partId: number): PartDemand => {
    const existing = byPart.get(partId);
    if (existing) return existing;
    const created: PartDemand = {
      partId,
      openDemandUnits: 0,
      uncommittedSupplyUnits: 0,
      netToMakeUnits: 0,
      openOrders: [],
    };
    byPart.set(partId, created);
    return created;
  };

  // sales orders in id order, which is creation order - no createdAt column
  for (const salesOrder of [...salesOrders].sort((a, b) => a.id - b.id)) {
    const remaining = remainingQty(salesOrder);
    if (remaining <= 0) continue;

    const entry = forPart(salesOrder.partId);
    entry.openDemandUnits += remaining;
    entry.openOrders.push({
      id: salesOrder.id,
      orderNumber: salesOrder.orderNumber,
      remaining,
      unitPriceCents: salesOrder.unitPriceCents,
    });
  }

  for (const workOrder of workOrders) {
    const allocated = workOrder.allocations.reduce(
      (total, allocation) => total + allocation.quantity,
      0,
    );
    const uncommitted = workOrder.quantity - allocated;
    if (uncommitted <= 0) continue;
    forPart(workOrder.partId).uncommittedSupplyUnits += uncommitted;
  }

  const summaries: PartDemand[] = [];
  for (const entry of byPart.values()) {
    if (entry.openDemandUnits <= 0) continue;
    entry.netToMakeUnits = Math.max(
      0,
      entry.openDemandUnits - entry.uncommittedSupplyUnits,
    );
    summaries.push(entry);
  }

  return summaries.sort(
    (a, b) => b.netToMakeUnits - a.netToMakeUnits || a.partId - b.partId,
  );
}

/** Total units of open demand across every part - the headline number. */
export function totalOpenDemand(summaries: PartDemand[]): number {
  return summaries.reduce((total, entry) => total + entry.openDemandUnits, 0);
}
