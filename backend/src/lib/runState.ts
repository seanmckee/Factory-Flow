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
import { setupKey } from "../simulation/simulationTick.js";
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
  // These five reads share only the run id. Issuing them together matters on
  // Neon, where serial network latency can otherwise dominate a small batch.
  const [storedParts, storedSteps, storedCenters, released, finishedCounts] =
    await Promise.all([
      db
        .select()
        .from(runWipParts)
        .where(eq(runWipParts.runId, run.id))
        .orderBy(runWipParts.id),
      db
        .select({
          workOrderId: runWorkOrderSteps.workOrderId,
          workCenterId: runWorkOrderSteps.workCenterId,
          processTimeSeconds: runWorkOrderSteps.processTimeSeconds,
          setupTimeSeconds: runWorkOrderSteps.setupTimeSeconds,
          scrapBps: runWorkOrderSteps.scrapBps,
          setupStartedAtTick: runWorkOrderSteps.setupStartedAtTick,
        })
        .from(runWorkOrderSteps)
        .where(eq(runWorkOrderSteps.runId, run.id))
        .orderBy(runWorkOrderSteps.workOrderId, runWorkOrderSteps.sequence),
      db
        .select({
          workCenterId: runWorkCenters.workCenterId,
          capacity: runWorkCenters.capacity,
          standingCostCentsPerDay: runWorkCenters.standingCostCentsPerDay,
        })
        .from(runWorkCenters)
        .where(eq(runWorkCenters.runId, run.id)),
      db
        .select({ workOrderId: runReleasedOrders.workOrderId })
        .from(runReleasedOrders)
        .where(eq(runReleasedOrders.runId, run.id)),
      db
        .select({
          workOrderId: runFinishedParts.workOrderId,
          finished: count(),
        })
        .from(runFinishedParts)
        .where(eq(runFinishedParts.runId, run.id))
        .groupBy(runFinishedParts.workOrderId),
    ]);

  const releasedIds = released.map((row) => row.workOrderId);
  const [runWorkOrders, runAllocations] = releasedIds.length
    ? await Promise.all([
        db
          .select({ id: workOrders.id, partId: workOrders.partId })
          .from(workOrders)
          .where(inArray(workOrders.id, releasedIds)),
        db
          .select()
          .from(allocations)
          .where(inArray(allocations.workOrderId, releasedIds)),
      ])
    : [[], []];

  const partIds = [...new Set(runWorkOrders.map((wo) => wo.partId))];
  const salesOrderIds = [
    ...new Set(runAllocations.map((allocation) => allocation.salesOrderId)),
  ];
  // The demand side is read live per advance *request* — loaded once here and
  // reused across that request's batches — so a price or due-day edit lands
  // between advances, never mid-advance, and touches only units not yet
  // finished. Due days convert to the run's own ticks right here, the one
  // place calendar days become ticks: the engine speaks ticks only, and the
  // run's frozen dayTicks is what makes "day N" mean the same promise however
  // a run is staffed.
  const [runParts, storedSalesOrders] = await Promise.all([
    partIds.length
      ? db
          .select({ id: parts.id, materialCostCents: parts.materialCostCents })
          .from(parts)
          .where(inArray(parts.id, partIds))
      : Promise.resolve([]),
    salesOrderIds.length
      ? db
          .select({
            id: salesOrders.id,
            unitPriceCents: salesOrders.unitPriceCents,
            dueDay: salesOrders.dueDay,
          })
          .from(salesOrders)
          .where(inArray(salesOrders.id, salesOrderIds))
      : Promise.resolve([]),
  ]);
  const runSalesOrders = storedSalesOrders.map((so) => ({
    id: so.id,
    unitPriceCents: so.unitPriceCents,
    dueAtTick: so.dueDay === null ? null : so.dueDay * run.dayTicks,
  }));

  const routingByWorkOrder = new Map<number, Routing>();
  // The rows arrive ordered by (work order, sequence) and sequences are dense
  // from 0, so a step's position in the array is its sequence — the same
  // identity the engine uses, which is what lets the setup keys use it too.
  const setupDone = new Set<string>();
  for (const step of storedSteps) {
    const routing = routingByWorkOrder.get(step.workOrderId);
    const stepIndex = routing?.steps.length ?? 0;
    if (step.setupStartedAtTick !== null) {
      setupDone.add(setupKey(step.workOrderId, stepIndex));
    }
    const stored = {
      workCenterId: step.workCenterId,
      processTimeSeconds: step.processTimeSeconds,
      setupTimeSeconds: step.setupTimeSeconds,
      scrapBps: step.scrapBps,
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
    setupDone,
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
