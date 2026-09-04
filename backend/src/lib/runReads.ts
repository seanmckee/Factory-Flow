import { and, count, desc, eq, gte, lte, sql, sum } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  runCapitalActions,
  runFinishedParts,
  runReleasedOrders,
  runScrappedParts,
  runBucketWorkCenters,
  runBuckets,
  runWipParts,
  runWorkCenters,
  runWorkOrderSteps,
  simulationRuns,
  workCenters,
} from "../db/schema.js";
import {
  deriveFloorView,
  type WorkCenterFloorView,
} from "../simulation/floorView.js";
import {
  aggregateCycleTime,
  aggregateOnTimeDelivery,
  aggregateScrap,
  groupDeliveryBySalesOrder,
  aggregateMetrics,
  type CycleTimeAggregate,
  type OnTimeDeliveryAggregate,
  type SalesOrderDelivery,
  type ScrapAggregate,
  type MetricsAggregate,
} from "../simulation/metrics.js";
import {
  TICKS_PER_BUCKET,
  bucketStartTick,
  type BucketWorkCenterMetrics,
  type ObservationBucket,
} from "../simulation/observationBuckets.js";
import { HttpError } from "./httpError.js";
import type { RunRow } from "./runState.js";
import type { Routing, WipPart } from "../simulation/types.js";

/**
 * The read side of the run API: summaries, windowed metrics, the floor
 * snapshot and the tick series. Nothing here writes or takes the advance
 * lock — that is `runService.ts`, the write side.
 */

/**
 * Resolves an optional tick window against how far a run has got. Ticks are
 * numbered from 1, so a run that has never advanced spans nothing — and that
 * is not an error: `aggregateMetrics` and `aggregateCycleTime` both answer an
 * empty window with zeroes and nulls, and a run is created before it is
 * advanced, so the page reads one at tick 0 every time.
 *
 * Only a window the caller *asked* for backwards is a 400. Defaulting `to` to
 * tick 0 on a fresh run is the API's own doing and must not be blamed on the
 * request.
 */
function tickWindow(
  fromTick: number | undefined,
  toTick: number | undefined,
  tickNum: number,
): { from: number; to: number } {
  if (fromTick !== undefined && toTick !== undefined && toTick < fromTick) {
    throw new HttpError(400, `toTick ${toTick} is before fromTick ${fromTick}`);
  }
  // The default window is the **whole run**, and a run begins at tick 0, not at
  // tick 1: ticks are numbered from 1, but tick 0 is a real moment at which
  // money can be spent — a capital action applied before the first advance,
  // which is exactly when a machine is worth buying. Defaulting to 1 dropped
  // that spend from every whole-run `/metrics`, so the dashboard read a run
  // better than it was while the run bar's summary told the truth (the
  // playground playthrough disagreed by the $3,208 it opened by spending).
  // Nothing else moves: no tick, finished part or scrapped part is ever at 0,
  // and `/ticks` still drops a tick-0 action from the series rather than
  // misdating it, because no row's bucket contains it.
  return { from: fromTick ?? 0, to: toTick ?? tickNum };
}

export type RunSummary = RunRow & {
  wipCount: number;
  finishedCount: number;
  /** every unit's frozen throughput, summed */
  throughputCents: number;
  /** every tick's frozen expense, summed — never re-derived from rates */
  operatingExpenseCents: number;
  carryingCostCents: number;
  /** operator pay, summed from the same frozen tick column */
  wageCents: number;
  /**
   * Capital spent, summed from the frozen action rows — salvage is a negative
   * spend, so a run that bought and retired the same machine shows the loss it
   * really took. Not a per-tick accrual: capital leaves at a moment, which is
   * what makes payback readable off the net curve.
   */
  capitalSpendCents: number;
  /**
   * throughput − expense − carrying − wages − capital: the score, and it can
   * go negative
   */
  netCents: number;
  releasedOrders: {
    workOrderId: number;
    routingId: number;
    routingRevision: string;
  }[];
};

export async function listRuns(): Promise<RunRow[]> {
  return db.select().from(simulationRuns).orderBy(simulationRuns.id);
}

/**
 * A run and the counts that say where it got to. The money is summed from
 * frozen columns — throughput from the per-unit credits rather than from
 * `run_buckets`, so it stays the same figure the finished parts justify, and
 * expense from the per-tick cents, so a rate edit (or 6E capital action)
 * cannot rewrite what a run already spent.
 */
export async function getRun(runId: number): Promise<RunSummary> {
  const [run] = await db
    .select()
    .from(simulationRuns)
    .where(eq(simulationRuns.id, runId));
  if (!run) throw new HttpError(404, `Run ${runId} not found`);

  const [[wip], [finished], [expense], [capital], releasedOrders] =
    await Promise.all([
    db
      .select({ count: count() })
      .from(runWipParts)
      .where(eq(runWipParts.runId, runId)),
    db
      .select({
        count: count(),
        throughputCents: sum(runFinishedParts.throughputCents),
      })
      .from(runFinishedParts)
      .where(eq(runFinishedParts.runId, runId)),
    db
      .select({
        operatingExpenseCents: sum(runBuckets.operatingExpenseCents),
        carryingCostCents: sum(runBuckets.carryingCostCents),
        wageCents: sum(runBuckets.wageCents),
      })
      .from(runBuckets)
      .where(eq(runBuckets.runId, runId)),
    db
      .select({ spendCents: sum(runCapitalActions.spendCents) })
      .from(runCapitalActions)
      .where(eq(runCapitalActions.runId, runId)),
    db
      .select({
        workOrderId: runReleasedOrders.workOrderId,
        routingId: runReleasedOrders.routingId,
        routingRevision: runReleasedOrders.routingRevision,
      })
      .from(runReleasedOrders)
      .where(eq(runReleasedOrders.runId, runId))
      .orderBy(runReleasedOrders.workOrderId),
  ]);

  // sum() is null over no rows, and arrives as a string from the driver
  const throughputCents = Number(finished?.throughputCents ?? 0);
  const operatingExpenseCents = Number(expense?.operatingExpenseCents ?? 0);
  const carryingCostCents = Number(expense?.carryingCostCents ?? 0);
  const wageCents = Number(expense?.wageCents ?? 0);
  const capitalSpendCents = Number(capital?.spendCents ?? 0);

  return {
    ...run,
    wipCount: Number(wip?.count ?? 0),
    finishedCount: Number(finished?.count ?? 0),
    throughputCents,
    operatingExpenseCents,
    carryingCostCents,
    wageCents,
    capitalSpendCents,
    netCents:
      throughputCents -
      operatingExpenseCents -
      carryingCostCents -
      wageCents -
      capitalSpendCents,
    releasedOrders,
  };
}

export type RunMetrics = {
  fromTick: number;
  toTick: number;
  throughputCents: number;
  /** the window's frozen per-tick expense, summed like its throughput */
  operatingExpenseCents: number;
  carryingCostCents: number;
  wageCents: number;
  /** capital spent in the window, windowed on its own `applied_at_tick` */
  capitalSpendCents: number;
  netCents: number;
  flow: MetricsAggregate;
  cycleTime: CycleTimeAggregate;
  /**
   * The window's finishes against their promises, over the same rows cycle
   * time windows. Reads only the frozen `due_at_tick` — never `sales_order_id`,
   * whose ON DELETE SET NULL would silently unmeasure a deleted order's units.
   */
  onTimeDelivery: OnTimeDeliveryAggregate;
  /** the same finishes per covering order; names join client-side, like /floor */
  salesOrderDelivery: SalesOrderDelivery[];
  /** the window's ruined units, windowed on `scrapped_at_tick` */
  scrap: ScrapAggregate;
};

/**
 * The observations over a tick window, which is what an experiment is read
 * from. The two aggregates window independently — flow on `tick_num`, cycle
 * time on `completed_at_tick` — as the engine's own contract says, so this
 * filters each on its own column rather than joining them.
 *
 * Work centers come from the run's frozen capacities, so utilization divides by
 * the capacity the run actually ran with, not whatever the factory says now.
 */
export async function getRunMetrics(
  runId: number,
  fromTick?: number,
  toTick?: number,
): Promise<RunMetrics> {
  const [run] = await db
    .select()
    .from(simulationRuns)
    .where(eq(simulationRuns.id, runId));
  if (!run) throw new HttpError(404, `Run ${runId} not found`);

  const requested = tickWindow(fromTick, toTick, run.tickNum);
  // Snap the window to whole buckets, since a bucket is the finest thing
  // stored: it covers the minute containing `from` through the minute
  // containing `to`. Every line is then windowed on the *same* range — the
  // money from the buckets, and the finished, scrapped and capital rows on
  // their own per-tick columns — so the response's own label describes all of
  // them. Reporting a mid-minute label over minute-aligned money is the one
  // way this could mislead, and the label coming from the response is the rule
  // that stops it.
  const from = Math.max(1, bucketStartTick(requested.from, TICKS_PER_BUCKET));
  const to = Math.min(
    run.tickNum,
    bucketStartTick(requested.to, TICKS_PER_BUCKET) + TICKS_PER_BUCKET - 1,
  );

  const [bucketRows, centerRows, finished, scrapped, capital, storedCenters] =
    await Promise.all([
    db
      .select()
      .from(runBuckets)
      .where(
        and(
          eq(runBuckets.runId, runId),
          gte(runBuckets.startTick, from),
          lte(runBuckets.startTick, to),
        ),
      )
      .orderBy(runBuckets.startTick),
    db
      .select()
      .from(runBucketWorkCenters)
      .where(
        and(
          eq(runBucketWorkCenters.runId, runId),
          gte(runBucketWorkCenters.startTick, from),
          lte(runBucketWorkCenters.startTick, to),
        ),
      ),
    db
      .select()
      .from(runFinishedParts)
      .where(
        and(
          eq(runFinishedParts.runId, runId),
          gte(runFinishedParts.completedAtTick, from),
          lte(runFinishedParts.completedAtTick, to),
        ),
      )
      .orderBy(runFinishedParts.completedAtTick, runFinishedParts.id),
    db
      .select({ materialCostCents: runScrappedParts.materialCostCents })
      .from(runScrappedParts)
      .where(
        and(
          eq(runScrappedParts.runId, runId),
          gte(runScrappedParts.scrappedAtTick, from),
          lte(runScrappedParts.scrappedAtTick, to),
        ),
      ),
    db
      .select({ spendCents: sum(runCapitalActions.spendCents) })
      .from(runCapitalActions)
      .where(
        and(
          eq(runCapitalActions.runId, runId),
          gte(runCapitalActions.appliedAtTick, requested.from),
          lte(runCapitalActions.appliedAtTick, to),
        ),
      ),
    db
      .select({
        workCenterId: runWorkCenters.workCenterId,
        capacity: runWorkCenters.capacity,
        operators: runWorkCenters.operators,
      })
      .from(runWorkCenters)
      .where(eq(runWorkCenters.runId, runId))
      .orderBy(runWorkCenters.workCenterId),
  ]);

  // effective capacity as the run stands now. No longer a fallback for the
  // observations — every stored bucket carries its own `capacity_ticks`, the
  // pre-6E nulls having been resolved by 6G.1b's migration — but still the
  // roster `aggregateMetrics` lists, so a centre the window never saw appears
  // with zeroes instead of vanishing.
  const effectiveCapacity = new Map(
    storedCenters.map((center) => [
      center.workCenterId,
      Math.min(center.capacity, center.operators),
    ]),
  );

  const centersByStart = new Map<number, BucketWorkCenterMetrics[]>();
  for (const row of centerRows) {
    const entry = {
      workCenterId: row.workCenterId,
      observedTicks: row.observedTicks,
      busyMachineTicks: row.busyMachineTicks,
      capacityTicks: row.capacityTicks,
      queuedPartTicks: row.queuedPartTicks,
      maxQueueDepth: row.maxQueueDepth,
    };
    const list = centersByStart.get(row.startTick);
    if (list) list.push(entry);
    else centersByStart.set(row.startTick, [entry]);
  }

  const series: ObservationBucket[] = bucketRows.map((row) => ({
    startTick: row.startTick,
    tickCount: row.tickCount,
    wipPartTicks: row.wipPartTicks,
    maxWip: row.maxWip,
    endWip: row.endWip,
    workCenters: centersByStart.get(row.startTick) ?? [],
  }));

  const throughputCents = bucketRows.reduce(
    (total, row) => total + row.throughputCents,
    0,
  );
  const operatingExpenseCents = bucketRows.reduce(
    (total, row) => total + row.operatingExpenseCents,
    0,
  );
  const carryingCostCents = bucketRows.reduce(
    (total, row) => total + row.carryingCostCents,
    0,
  );
  const wageCents = bucketRows.reduce((total, row) => total + row.wageCents, 0);
  // capital windows on its own column, like scrap: it is an event at a tick,
  // not an accrual across them
  const capitalSpendCents = Number(capital[0]?.spendCents ?? 0);

  return {
    fromTick: from,
    toTick: to,
    throughputCents,
    operatingExpenseCents,
    carryingCostCents,
    wageCents,
    capitalSpendCents,
    netCents:
      throughputCents -
      operatingExpenseCents -
      carryingCostCents -
      wageCents -
      capitalSpendCents,
    // the roster only: utilization's denominator now comes from each
    // observation's own capacity, not from this map
    flow: aggregateMetrics(
      series,
      new Map(
        storedCenters.map((center) => [
          center.workCenterId,
          {
            id: center.workCenterId,
            capacity: effectiveCapacity.get(center.workCenterId) ?? 0,
          },
        ]),
      ),
    ),
    cycleTime: aggregateCycleTime(
      finished.map((part) => ({
        id: part.partUuid,
        workOrderId: part.workOrderId,
        releasedAtTick: part.releasedAtTick,
        completedAtTick: part.completedAtTick,
      })),
    ),
    onTimeDelivery: aggregateOnTimeDelivery(
      finished.map((part) => ({
        completedAtTick: part.completedAtTick,
        dueAtTick: part.dueAtTick,
      })),
    ),
    salesOrderDelivery: groupDeliveryBySalesOrder(
      finished.map((part) => ({
        salesOrderId: part.salesOrderId,
        completedAtTick: part.completedAtTick,
        dueAtTick: part.dueAtTick,
      })),
    ),
    scrap: aggregateScrap(scrapped),
  };
}

export type RunFloor = {
  tickNum: number;
  wipCount: number;
  workCenters: (WorkCenterFloorView & {
    name: string;
    /** effective capacity — `min(machines, operators)`, what admits a part */
    capacity: number;
    /** the two it is the lesser of, so the UI can price an action's effect */
    machines: number;
    operators: number;
    /** frozen, per **machine** — the centre's rent is machines × this */
    standingCostCentsPerDay: number;
    /** frozen per-operator hourly wage */
    wageCentsPerHour: number;
    /** the run's frozen capital prices: what an action here costs it */
    machinePurchaseCents: number;
    machineSalvageCents: number;
    operatorHireCents: number;
  })[];
};

/**
 * The shop floor as it stands, for the simulation page's cards. Capacity and
 * the step a part is on both come from the run's own frozen config, so the
 * picture is of the factory this run is actually running, not of the factory
 * as it has since been edited. Names come from `work_centers`, which is the
 * one thing a run has no copy of — renaming a center is cosmetic and a run
 * showing its current name is right.
 */
export async function getRunFloor(runId: number): Promise<RunFloor> {
  const [run] = await db
    .select()
    .from(simulationRuns)
    .where(eq(simulationRuns.id, runId));
  if (!run) throw new HttpError(404, `Run ${runId} not found`);

  // A floor snapshot needs only WIP and the run's pinned routing/capacity.
  // Loading the full advance state here also fetched demand, allocations,
  // finished counts and costs, turning a once-per-second UI read into a chain
  // of unnecessary database round trips.
  const [storedParts, storedSteps, storedCenters, liveCenters] = await Promise.all([
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
      })
      .from(runWorkOrderSteps)
      .where(eq(runWorkOrderSteps.runId, run.id))
      .orderBy(runWorkOrderSteps.workOrderId, runWorkOrderSteps.sequence),
    db
      .select()
      .from(runWorkCenters)
      .where(eq(runWorkCenters.runId, run.id)),
    db.select({ id: workCenters.id, name: workCenters.name }).from(workCenters),
  ]);

  const routingByWorkOrder = new Map<number, Routing>();
  for (const step of storedSteps) {
    const routing = routingByWorkOrder.get(step.workOrderId);
    const pinnedStep = {
      workCenterId: step.workCenterId,
      processTimeSeconds: step.processTimeSeconds,
      setupTimeSeconds: step.setupTimeSeconds,
      scrapBps: step.scrapBps,
    };
    if (routing) routing.steps.push(pinnedStep);
    else routingByWorkOrder.set(step.workOrderId, { steps: [pinnedStep] });
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
  // effective capacity, as the loader does: the floor draws the slots parts
  // can actually be admitted to, so a machine nobody is standing at is not a
  // slot
  const centerMap = new Map(
    storedCenters.map((center) => [
      center.workCenterId,
      {
        id: center.workCenterId,
        capacity: Math.min(center.capacity, center.operators),
      },
    ]),
  );
  const names = new Map(liveCenters.map((center) => [center.id, center.name]));
  const frozen = new Map(
    storedCenters.map((center) => [center.workCenterId, center]),
  );

  const view = deriveFloorView(
    wipParts,
    routingByWorkOrder,
    centerMap,
  );

  return {
    tickNum: run.tickNum,
    wipCount: wipParts.length,
    workCenters: view.map((center) => ({
      ...center,
      name: names.get(center.workCenterId) ?? `Work center ${center.workCenterId}`,
      capacity: centerMap.get(center.workCenterId)?.capacity ?? 0,
      machines: frozen.get(center.workCenterId)?.capacity ?? 0,
      operators: frozen.get(center.workCenterId)?.operators ?? 0,
      standingCostCentsPerDay:
        frozen.get(center.workCenterId)?.standingCostCentsPerDay ?? 0,
      wageCentsPerHour: frozen.get(center.workCenterId)?.wageCentsPerHour ?? 0,
      machinePurchaseCents:
        frozen.get(center.workCenterId)?.machinePurchaseCents ?? 0,
      machineSalvageCents:
        frozen.get(center.workCenterId)?.machineSalvageCents ?? 0,
      operatorHireCents:
        frozen.get(center.workCenterId)?.operatorHireCents ?? 0,
    })),
  };
}

export type TickSeriesRow = {
  tickNum: number;
  throughputCents: number;
  wipCount: number;
  operatingExpenseCents: number;
  carryingCostCents: number;
  wageCents: number;
  /**
   * Capital spent on this tick (or in this bucket) — joined from the action
   * rows in JS, the convention, since there are a handful of them per run and
   * no per-tick column to sum. Present so the net curve the chart draws
   * subtracts the same five lines the run bar does; a purchase reads as a
   * cliff, which is the point of charging it as a lump.
   */
  capitalSpendCents: number;
};

/**
 * The per-tick series, for charting, optionally **bucketed**: `bucket = 60`
 * groups the window into simulated minutes — money summed (so the cumulative
 * and opening-balance identities hold exactly), WIP read at bucket end (a
 * level, not a flow). Buckets align to the absolute tick grid
 * (`floor((tick−1)/bucket)`), so two windows over one run agree bucket for
 * bucket. Capped rather than paged: a chart reads a window, and
 * `MAX_TICK_SERIES_ROWS` points is already more than a screen has pixels.
 * Returns the most recent rows in the window when it overflows, since a chart
 * following a live run wants the end of the series.
 */
export const MAX_TICK_SERIES_ROWS = 5000;

/** The window's capital actions, summed per tick they were applied at. */
async function capitalByTick(
  runId: number,
  from: number,
  to: number,
): Promise<Map<number, number>> {
  const rows = await db
    .select({
      appliedAtTick: runCapitalActions.appliedAtTick,
      spendCents: runCapitalActions.spendCents,
    })
    .from(runCapitalActions)
    .where(
      and(
        eq(runCapitalActions.runId, runId),
        gte(runCapitalActions.appliedAtTick, from),
        lte(runCapitalActions.appliedAtTick, to),
      ),
    );

  const byTick = new Map<number, number>();
  for (const row of rows) {
    byTick.set(
      row.appliedAtTick,
      (byTick.get(row.appliedAtTick) ?? 0) + row.spendCents,
    );
  }
  return byTick;
}

/**
 * Attaches each tick's (or bucket's) capital spend. A row's `tickNum` is the
 * last tick it covers, so its bucket index is `floor((tickNum−1)/bucket)` —
 * the same grid the SQL grouped on, which is what makes an action land in the
 * bucket that contains it.
 *
 * An action applied at a tick with no row in the series — tick 0, or one
 * outside the window — is deliberately not forced in: the chart's opening
 * balance is the run's total minus the window's own sum, so spend before the
 * window is carried there rather than misdated into the first visible point.
 */
function withCapitalSpend(
  rows: Omit<TickSeriesRow, "capitalSpendCents">[],
  byTick: Map<number, number>,
  bucket: number,
): TickSeriesRow[] {
  const width = Math.max(1, bucket);
  const byBucket = new Map<number, number>();
  for (const [tick, cents] of byTick) {
    const index = Math.floor((tick - 1) / width);
    byBucket.set(index, (byBucket.get(index) ?? 0) + cents);
  }

  return rows.map((row) => ({
    ...row,
    capitalSpendCents: byBucket.get(Math.floor((row.tickNum - 1) / width)) ?? 0,
  }));
}

export async function getRunTicks(
  runId: number,
  fromTick?: number,
  toTick?: number,
  bucket = 1,
): Promise<TickSeriesRow[]> {
  const [run] = await db
    .select({ id: simulationRuns.id, tickNum: simulationRuns.tickNum })
    .from(simulationRuns)
    .where(eq(simulationRuns.id, runId));
  if (!run) throw new HttpError(404, `Run ${runId} not found`);

  const { from, to } = tickWindow(fromTick, toTick, run.tickNum);
  // whole buckets, since a bucket is the finest thing stored: the window covers
  // the minute containing `from` onward, and the response says so
  const inWindow = and(
    eq(runBuckets.runId, runId),
    gte(runBuckets.startTick, Math.max(1, bucketStartTick(from, TICKS_PER_BUCKET))),
    lte(runBuckets.startTick, to),
  );

  // A row's `tickNum` is the last tick it covers, which for a partial bucket is
  // short of its slot — so it comes off the stored count rather than the grid.
  const lastTick = sql<number>`${runBuckets.startTick} + ${runBuckets.tickCount} - 1`;

  if (bucket <= TICKS_PER_BUCKET) {
    // already the stored resolution; nothing to regroup
    const rows = await db
      .select({
        tickNum: lastTick,
        throughputCents: runBuckets.throughputCents,
        wipCount: runBuckets.endWip,
        operatingExpenseCents: runBuckets.operatingExpenseCents,
        carryingCostCents: runBuckets.carryingCostCents,
        wageCents: runBuckets.wageCents,
      })
      .from(runBuckets)
      .where(inWindow)
      .orderBy(desc(runBuckets.startTick))
      .limit(MAX_TICK_SERIES_ROWS);

    // read newest-first to cap at the end of the window, handed back in order
    return withCapitalSpend(
      rows.reverse().map((row) => ({ ...row, tickNum: Number(row.tickNum) })),
      await capitalByTick(runId, from, to),
      TICKS_PER_BUCKET,
    );
  }

  // Regrouping coarser: buckets group by the slot their own start falls in, so
  // the coarse grid nests inside the stored one. Integer division on int
  // columns — Postgres truncates, which is the floor for the non-negative tick
  // numbers involved. The width is inlined rather than bound: GROUP BY and
  // ORDER BY must be the *same expression*, and two occurrences of a bind
  // parameter are two expressions to Postgres. Safe — zod has already proven it
  // a positive integer, and the floor re-proves it.
  const width = Math.floor(bucket);
  const bucketGroup = sql`(${runBuckets.startTick} - 1) / ${sql.raw(String(width))}`;
  const rows = await db
    .select({
      tickNum: sql<number>`max(${runBuckets.startTick} + ${runBuckets.tickCount} - 1)`,
      throughputCents: sql<number>`sum(${runBuckets.throughputCents})::int`,
      // the closing level of the newest bucket in the group, the same
      // array_agg trick a per-tick series used for the newest tick
      wipCount: sql<number>`(array_agg(${runBuckets.endWip} order by ${runBuckets.startTick} desc))[1]`,
      operatingExpenseCents: sql<number>`sum(${runBuckets.operatingExpenseCents})::int`,
      carryingCostCents: sql<number>`sum(${runBuckets.carryingCostCents})::int`,
      wageCents: sql<number>`sum(${runBuckets.wageCents})::int`,
    })
    .from(runBuckets)
    .where(inWindow)
    .groupBy(bucketGroup)
    .orderBy(sql`${bucketGroup} desc`)
    .limit(MAX_TICK_SERIES_ROWS);

  return withCapitalSpend(
    rows.reverse().map((row) => ({
      tickNum: Number(row.tickNum),
      throughputCents: Number(row.throughputCents),
      wipCount: Number(row.wipCount),
      operatingExpenseCents: Number(row.operatingExpenseCents),
      carryingCostCents: Number(row.carryingCostCents),
      wageCents: Number(row.wageCents),
    })),
    await capitalByTick(runId, from, to),
    width,
  );
}

export type CapitalActionRow = {
  id: number;
  kind: string;
  workCenterId: number;
  appliedAtTick: number;
  spendCents: number;
  machinesAfter: number;
  operatorsAfter: number;
};

/**
 * A run's capital actions, oldest first — the log that explains how its frozen
 * config got to where it is. Names join client-side off `/floor`, as
 * everywhere: a run keeps no copy of a work centre's name.
 */
export async function listCapitalActions(
  runId: number,
): Promise<CapitalActionRow[]> {
  const [run] = await db
    .select({ id: simulationRuns.id })
    .from(simulationRuns)
    .where(eq(simulationRuns.id, runId));
  if (!run) throw new HttpError(404, `Run ${runId} not found`);

  return db
    .select({
      id: runCapitalActions.id,
      kind: runCapitalActions.kind,
      workCenterId: runCapitalActions.workCenterId,
      appliedAtTick: runCapitalActions.appliedAtTick,
      spendCents: runCapitalActions.spendCents,
      machinesAfter: runCapitalActions.machinesAfter,
      operatorsAfter: runCapitalActions.operatorsAfter,
    })
    .from(runCapitalActions)
    .where(eq(runCapitalActions.runId, runId))
    .orderBy(runCapitalActions.appliedAtTick, runCapitalActions.id);
}
