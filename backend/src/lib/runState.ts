import { count, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  allocations,
  parts,
  runFinishedParts,
  runReleasedOrders,
  runWipParts,
  runWorkCenters,
  runWorkOrderSteps,
  salesOrders,
  simulationRuns,
  workOrders,
} from "../db/schema.js";
import type { RunState } from "../simulation/simulateBatch.js";
import type { Routing, WipPart } from "../simulation/types.js";

export type RunRow = typeof simulationRuns.$inferSelect;

/**
 * Reads everything a batch needs. The config half comes from the run's own
 * tables; the demand half (orders, prices, allocations) is still read live,
 * which is why finished money is frozen as it is credited rather than
 * recomputed later.
 *
 * Shared by the write side (`runService.advanceRun`) and the read side
 * (`runReads.getRunFloor`), which is why it lives in its own module rather
 * than either of theirs.
 */
export async function loadRunState(run: RunRow): Promise<RunState> {
  const storedParts = await db
    .select()
    .from(runWipParts)
    .where(eq(runWipParts.runId, run.id))
    .orderBy(runWipParts.id);

  const storedSteps = await db
    .select({
      workOrderId: runWorkOrderSteps.workOrderId,
      workCenterId: runWorkOrderSteps.workCenterId,
      processTimeSeconds: runWorkOrderSteps.processTimeSeconds,
    })
    .from(runWorkOrderSteps)
    .where(eq(runWorkOrderSteps.runId, run.id))
    .orderBy(runWorkOrderSteps.workOrderId, runWorkOrderSteps.sequence);

  const storedCenters = await db
    .select({
      workCenterId: runWorkCenters.workCenterId,
      capacity: runWorkCenters.capacity,
      standingCostCentsPerDay: runWorkCenters.standingCostCentsPerDay,
    })
    .from(runWorkCenters)
    .where(eq(runWorkCenters.runId, run.id));

  const released = await db
    .select({ workOrderId: runReleasedOrders.workOrderId })
    .from(runReleasedOrders)
    .where(eq(runReleasedOrders.runId, run.id));

  const finishedCounts = await db
    .select({
      workOrderId: runFinishedParts.workOrderId,
      finished: count(),
    })
    .from(runFinishedParts)
    .where(eq(runFinishedParts.runId, run.id))
    .groupBy(runFinishedParts.workOrderId);

  const releasedIds = released.map((row) => row.workOrderId);
  const runWorkOrders = releasedIds.length
    ? await db
        .select({ id: workOrders.id, partId: workOrders.partId })
        .from(workOrders)
        .where(inArray(workOrders.id, releasedIds))
    : [];

  const partIds = [...new Set(runWorkOrders.map((wo) => wo.partId))];
  const runParts = partIds.length
    ? await db
        .select({ id: parts.id, materialCostCents: parts.materialCostCents })
        .from(parts)
        .where(inArray(parts.id, partIds))
    : [];

  const runAllocations = releasedIds.length
    ? await db
        .select()
        .from(allocations)
        .where(inArray(allocations.workOrderId, releasedIds))
    : [];

  const salesOrderIds = [
    ...new Set(runAllocations.map((allocation) => allocation.salesOrderId)),
  ];
  const runSalesOrders = salesOrderIds.length
    ? await db
        .select({ id: salesOrders.id, unitPriceCents: salesOrders.unitPriceCents })
        .from(salesOrders)
        .where(inArray(salesOrders.id, salesOrderIds))
    : [];

  const routingByWorkOrder = new Map<number, Routing>();
  for (const step of storedSteps) {
    const routing = routingByWorkOrder.get(step.workOrderId);
    const stored = {
      workCenterId: step.workCenterId,
      processTimeSeconds: step.processTimeSeconds,
    };
    if (routing) routing.steps.push(stored);
    else routingByWorkOrder.set(step.workOrderId, { steps: [stored] });
  }

  const wipParts: WipPart[] = storedParts.map((part) => ({
    id: part.partUuid,
    workOrderId: part.workOrderId,
    unitIndex: part.unitIndex,
    releasedAtTick: part.releasedAtTick,
    stepIndex: part.stepIndex,
    progressSeconds: part.progressSeconds,
    actualProcessTimeSeconds: part.actualProcessTimeSeconds,
  }));

  return {
    tickNum: run.tickNum,
    rngSeed: run.rngSeed,
    wipParts,
    routingByWorkOrder,
    workCenters: new Map(
      storedCenters.map((center) => [
        center.workCenterId,
        { id: center.workCenterId, capacity: center.capacity },
      ]),
    ),
    workOrders: runWorkOrders,
    parts: runParts,
    salesOrders: runSalesOrders,
    allocations: runAllocations,
    priorCounts: new Map(
      finishedCounts.map((row) => [row.workOrderId, Number(row.finished)]),
    ),
    costs: {
      dayTicks: run.dayTicks,
      facilityOverheadCentsPerDay: run.facilityOverheadCentsPerDay,
      wipCarryingBpsPerDay: run.wipCarryingBpsPerDay,
      standingCostByWorkCenter: new Map(
        storedCenters.map((center) => [
          center.workCenterId,
          center.standingCostCentsPerDay,
        ]),
      ),
    },
    carryRemainder: run.carryRemainder,
  };
}
