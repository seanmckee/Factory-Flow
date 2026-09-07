import { count, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  allocations,
  parts,
  routingSteps,
  routings,
  runFinishedParts,
  runReleasedOrders,
  runWipParts,
  runWorkCenters,
  runWorkOrderSteps,
  salesOrders,
  simulationRuns,
  workOrders,
} from "../db/schema.js";
import type { AdmittableOrder } from "../simulation/releaseAdmission.js";
import type { BacklogOrder } from "../simulation/releasePolicy.js";
import type { RunState } from "../simulation/simulateBatch.js";
import { setupKey } from "../simulation/simulationTick.js";
import type { Routing, RoutingStep, WipPart } from "../simulation/types.js";

export type RunRow = typeof simulationRuns.$inferSelect;

/**
 * Reads everything a batch needs. The config half comes from the run's own
 * tables; the demand half (orders, prices, allocations) is still read live,
 * which is why finished money is frozen as it is credited rather than
 * recomputed later.
 *
 * `advanceRun` is the only caller now — the floor read used to share it and
 * loads its own slimmer set — but the loader stays in its own module: it is
 * the run's one load boundary, and the place calendar days become ticks.
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
          operators: runWorkCenters.operators,
          standingCostCentsPerDay: runWorkCenters.standingCostCentsPerDay,
          wageCentsPerHour: runWorkCenters.wageCentsPerHour,
          standingCostEffectiveFromTick:
            runWorkCenters.standingCostEffectiveFromTick,
          wageEffectiveFromTick: runWorkCenters.wageEffectiveFromTick,
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
    // effective capacity, not the machine count: a machine with nobody on it
    // runs nothing, and an operator with no machine runs nothing either. The
    // min is taken here so the engine never learns what an operator is — the
    // same boundary the pre-multiplied wage rates sit on.
    workCenters: new Map(
      storedCenters.map((center) => [
        center.workCenterId,
        {
          id: center.workCenterId,
          capacity: Math.min(center.capacity, center.operators),
        },
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
      // the centre's whole daily rent: the frozen rate is per **machine**
      // since 6E, and pre-multiplying here keeps the engine ignorant of what a
      // machine is. The dates are what make a mid-run purchase exact — each
      // rate accrues from the tick it took effect, and a rate no action has
      // touched still reads 0, which is the pre-6E arithmetic exactly.
      standingCostByWorkCenter: new Map(
        storedCenters.map((center) => [
          center.workCenterId,
          {
            cents: center.capacity * center.standingCostCentsPerDay,
            sinceTick: center.standingCostEffectiveFromTick,
          },
        ]),
      ),
      // the centre's whole hourly bill, pre-multiplied by its operators for
      // the same reason — hiring moves this rate and nothing else's
      wageCentsPerHourByWorkCenter: new Map(
        storedCenters.map((center) => [
          center.workCenterId,
          {
            cents: center.operators * center.wageCentsPerHour,
            sinceTick: center.wageEffectiveFromTick,
          },
        ]),
      ),
    },
    carryRemainder: run.carryRemainder,
  };
}

/**
 * One unreleased work order, loaded with everything both halves of an
 * auto-release need: the planner's view (`BacklogOrder`) and the admission's
 * graft (`AdmittableOrder`), plus the provenance the `run_released_orders`
 * row records.
 */
export type LoadedBacklogOrder = BacklogOrder &
  AdmittableOrder & { routingId: number; routingRevision: string };

/**
 * The un-released backlog, as a release policy sees it. Read **live and once
 * per advance request**, the same contract as the demand side above: a work
 * order created mid-advance is invisible until the next request, and editing
 * the order book between branch advances diverges same-seed runs for a reason
 * the seed doesn't explain — a caveat, not a bug.
 *
 * Orders with no routing or no steps are excluded rather than carried: they
 * can never release (the manual endpoint 404s/400s them), and a policy that
 * kept planning one would wedge every evaluation on the same dead order.
 */
export async function loadReleaseBacklog(
  run: RunRow,
  releasedIds: ReadonlySet<number>,
): Promise<LoadedBacklogOrder[]> {
  const allOrders = await db
    .select({
      id: workOrders.id,
      partId: workOrders.partId,
      routingId: workOrders.routingId,
      quantity: workOrders.quantity,
    })
    .from(workOrders);
  const unreleased = allOrders.filter((order) => !releasedIds.has(order.id));
  if (unreleased.length === 0) return [];

  const routingIds = [...new Set(unreleased.map((order) => order.routingId))];
  const orderIds = unreleased.map((order) => order.id);
  const partIds = [...new Set(unreleased.map((order) => order.partId))];

  const [routingRows, stepRows, allocationRows, partRows] = await Promise.all([
    db
      .select({ id: routings.id, revision: routings.revision })
      .from(routings)
      .where(inArray(routings.id, routingIds)),
    db
      .select({
        routingId: routingSteps.routingId,
        workCenterId: routingSteps.workCenterId,
        processTimeSeconds: routingSteps.processTimeSeconds,
        setupTimeSeconds: routingSteps.setupTimeSeconds,
        scrapBps: routingSteps.scrapBps,
      })
      .from(routingSteps)
      .where(inArray(routingSteps.routingId, routingIds))
      .orderBy(routingSteps.routingId, routingSteps.sequence),
    db
      .select()
      .from(allocations)
      .where(inArray(allocations.workOrderId, orderIds)),
    db
      .select({ id: parts.id, materialCostCents: parts.materialCostCents })
      .from(parts)
      .where(inArray(parts.id, partIds)),
  ]);

  const salesOrderIds = [
    ...new Set(allocationRows.map((allocation) => allocation.salesOrderId)),
  ];
  const salesOrderRows = salesOrderIds.length
    ? await db
        .select({
          id: salesOrders.id,
          unitPriceCents: salesOrders.unitPriceCents,
          dueDay: salesOrders.dueDay,
        })
        .from(salesOrders)
        .where(inArray(salesOrders.id, salesOrderIds))
    : [];

  const revisionByRouting = new Map(
    routingRows.map((routing) => [routing.id, routing.revision]),
  );
  const stepsByRouting = new Map<number, RoutingStep[]>();
  for (const row of stepRows) {
    const step: RoutingStep = {
      workCenterId: row.workCenterId,
      processTimeSeconds: row.processTimeSeconds,
      setupTimeSeconds: row.setupTimeSeconds,
      scrapBps: row.scrapBps,
    };
    const steps = stepsByRouting.get(row.routingId);
    if (steps) steps.push(step);
    else stepsByRouting.set(row.routingId, [step]);
  }
  const partById = new Map(partRows.map((part) => [part.id, part]));
  // due days convert to the run's own ticks here, like the released demand
  const salesOrderById = new Map(
    salesOrderRows.map((so) => [
      so.id,
      {
        id: so.id,
        unitPriceCents: so.unitPriceCents,
        dueAtTick: so.dueDay === null ? null : so.dueDay * run.dayTicks,
      },
    ]),
  );

  const backlog: LoadedBacklogOrder[] = [];
  for (const order of unreleased) {
    const steps = stepsByRouting.get(order.routingId);
    const routingRevision = revisionByRouting.get(order.routingId);
    if (!steps || steps.length === 0 || routingRevision === undefined) continue;
    const part = partById.get(order.partId);
    // the FK is NOT NULL RESTRICT, so a missing part is a bug, not a state
    if (!part) throw new Error(`Work order ${order.id} names missing part ${order.partId}`);

    const covering = allocationRows.filter(
      (allocation) => allocation.workOrderId === order.id,
    );
    const coveringSalesOrders = [
      ...new Set(covering.map((allocation) => allocation.salesOrderId)),
    ].flatMap((id) => {
      const so = salesOrderById.get(id);
      if (!so) throw new Error(`Allocation names missing sales order ${id}`);
      return [so];
    });
    const dueTicks = coveringSalesOrders
      .map((so) => so.dueAtTick)
      .filter((due): due is number => due !== null);

    backlog.push({
      workOrderId: order.id,
      quantity: order.quantity,
      dueAtTick: dueTicks.length ? Math.min(...dueTicks) : null,
      workCenterIds: new Set(steps.map((step) => step.workCenterId)),
      steps,
      workOrder: { id: order.id, partId: order.partId },
      part,
      salesOrders: coveringSalesOrders,
      allocations: covering,
      routingId: order.routingId,
      routingRevision,
    });
  }
  return backlog;
}
