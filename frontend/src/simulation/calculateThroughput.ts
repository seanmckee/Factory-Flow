import type { Part } from "../types/Part";
import type { WipPart } from "../types/WipPart";
import type { WorkOrder } from "../types/WorkOrder";
import type { SalesOrder, Allocation } from "../types/SalesOrder";

export function calculateThroughput(
  justFinished: WipPart[],
  allFinished: WipPart[],
  workOrders: WorkOrder[],
  parts: Part[],
  salesOrders: SalesOrder[],
): number {
  const workOrderById = new Map<number, WorkOrder>();
  for (const workOrder of workOrders) {
    workOrderById.set(workOrder.id, workOrder);
  }
  const partById = new Map<number, Part>();
  for (const part of parts) {
    partById.set(part.id, part);
  }
  const allocationsByWorkOrder = new Map<number, Allocation[]>();
  for (const so of salesOrders) {
    for (const alloc of so.allocations) {
      const list = allocationsByWorkOrder.get(alloc.workOrderId) ?? [];
      list.push(alloc);
      allocationsByWorkOrder.set(alloc.workOrderId, list);
    }
  }

  for (const list of allocationsByWorkOrder.values()) {
    list.sort((a, b) => a.id - b.id);
  }

  const salesOrderById = new Map<number, SalesOrder>();
  for (const so of salesOrders) {
    salesOrderById.set(so.id, so);
  }

  let total = 0;
  const completedSoFar = new Map<number, number>();

  for (const finishedPart of justFinished) {
    const wo = workOrderById.get(finishedPart.workOrderId);
    if (!wo) continue;
    const part = partById.get(wo.partId);
    if (!part) continue;

    const materialCost = part.materialCostCents;

    const priorCount = allFinished.filter(
      (p) => p.workOrderId === finishedPart.workOrderId,
    ).length;

    const alreadyThisTick = completedSoFar.get(finishedPart.workOrderId) ?? 0;
    const unitIndex = priorCount + alreadyThisTick;

    const allocs = allocationsByWorkOrder.get(finishedPart.workOrderId) ?? [];

    let runningTotal = 0;
    let covering: Allocation | undefined;
    for (const alloc of allocs) {
      runningTotal += alloc.quantity;
      if (runningTotal > unitIndex) {
        covering = alloc;
        break;
      }
    }
    completedSoFar.set(finishedPart.workOrderId, alreadyThisTick + 1);

    if (!covering) continue;

    const so = salesOrderById.get(covering.salesOrderId);

    if (!so) continue;

    total += so.unitPriceCents - materialCost;
  }
  return total;
}
