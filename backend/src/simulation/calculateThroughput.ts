import type {
  Allocation,
  FinishedPart,
  Part,
  SalesOrder,
  WorkOrder,
} from "./types.js";

/**
 * Throughput in Goldratt's sense: money made through sales, not parts produced.
 * A finished unit earns `unitPriceCents - materialCostCents` only if an
 * allocation covers it; units beyond what was sold earn nothing, which is what
 * makes releasing everything a losing move once Track 6 charges for the WIP.
 *
 * `priorCounts` maps a work order to how many of its units finished before this
 * tick. Rescanning the whole finished history here cost O(finished^2) over a
 * run and would force a persisted run to reload its entire history every tick.
 *
 * Allocations arrive flat, as they are in the table, rather than nested under
 * their sales order as `GET /api/sales-orders` returns them.
 *
 * A record that is referenced but absent throws rather than quietly earning
 * nothing: the agent compares runs on money, and a silent zero reads to it as a
 * policy that lost money rather than as a bug. Note that this is not the same
 * as an *uncovered* unit — a work order with no allocations left simply earns
 * zero, which is the rule above, not a missing record. Deleting a sales order
 * cascades its allocations away, so that case surfaces as uncovered units and
 * never as a dangling reference.
 */
export function calculateThroughput(
  justFinished: FinishedPart[],
  priorCounts: Map<number, number>,
  workOrders: WorkOrder[],
  parts: Part[],
  salesOrders: SalesOrder[],
  allocations: Allocation[],
): number {
  const workOrderById = new Map(workOrders.map((wo) => [wo.id, wo]));
  const partById = new Map(parts.map((part) => [part.id, part]));
  const salesOrderById = new Map(salesOrders.map((so) => [so.id, so]));

  // id order is load-bearing: it decides which sales order — and so which price
  // — a unit is credited to, which is why a work order's allocations are
  // inserted in one statement, oldest demand first
  const allocationsByWorkOrder = new Map<number, Allocation[]>();
  for (const allocation of [...allocations].sort((a, b) => a.id - b.id)) {
    const list = allocationsByWorkOrder.get(allocation.workOrderId);
    if (list) list.push(allocation);
    else allocationsByWorkOrder.set(allocation.workOrderId, [allocation]);
  }

  let total = 0;
  /** work order id -> units of it credited so far in this tick */
  const finishedThisTick = new Map<number, number>();

  for (const finishedPart of justFinished) {
    const workOrder = workOrderById.get(finishedPart.workOrderId);
    if (!workOrder) {
      throw new Error(
        `Part ${finishedPart.id} finished against work order ${finishedPart.workOrderId}, which was not loaded`,
      );
    }
    const part = partById.get(workOrder.partId);
    if (!part) {
      throw new Error(
        `Work order ${workOrder.id} makes part ${workOrder.partId}, which was not loaded`,
      );
    }

    const unitIndex =
      (priorCounts.get(workOrder.id) ?? 0) +
      (finishedThisTick.get(workOrder.id) ?? 0);
    finishedThisTick.set(workOrder.id, (finishedThisTick.get(workOrder.id) ?? 0) + 1);

    const covering = coveringAllocation(
      allocationsByWorkOrder.get(workOrder.id) ?? [],
      unitIndex,
    );
    // sold nothing this deep into the work order: inventory, not revenue
    if (!covering) continue;

    const salesOrder = salesOrderById.get(covering.salesOrderId);
    if (!salesOrder) {
      throw new Error(
        `Allocation ${covering.id} credits sales order ${covering.salesOrderId}, which was not loaded`,
      );
    }

    total += salesOrder.unitPriceCents - part.materialCostCents;
  }

  return total;
}

/**
 * Which allocation covers the unit at `unitIndex`, counting units of the work
 * order from zero. Allocations are consumed in id order until one's quantity
 * reaches past the unit.
 */
function coveringAllocation(
  allocations: Allocation[],
  unitIndex: number,
): Allocation | undefined {
  let covered = 0;
  for (const allocation of allocations) {
    covered += allocation.quantity;
    if (covered > unitIndex) return allocation;
  }
  return undefined;
}
