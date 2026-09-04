import { and, count, desc, eq, gte, lte, sql, sum } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  runFinishedParts,
  runReleasedOrders,
  runTickWorkCenters,
  runTicks,
  runWipParts,
  runWorkCenters,
  simulationRuns,
  workCenters,
} from "../db/schema.js";
import {
  deriveFloorView,
  type WorkCenterFloorView,
} from "../simulation/floorView.js";
import {
  aggregateCycleTime,
  aggregateMetrics,
  type CycleTimeAggregate,
  type MetricsAggregate,
} from "../simulation/metrics.js";
import type {
  TickMetrics,
  TickWorkCenterMetrics,
} from "../simulation/simulationTick.js";
import { HttpError } from "./httpError.js";
import { loadRunState, type RunRow } from "./runState.js";

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
  return { from: fromTick ?? 1, to: toTick ?? tickNum };
}

export type RunSummary = RunRow & {
  wipCount: number;
  finishedCount: number;
  /** every unit's frozen throughput, summed */
  throughputCents: number;
  /** every tick's frozen expense, summed — never re-derived from rates */
  operatingExpenseCents: number;
  carryingCostCents: number;
  /** throughput − operating expense − carrying: the run's score, and it can go negative */
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
 * `run_ticks`, so it stays the same figure the finished parts justify, and
 * expense from the per-tick cents, so a rate edit (or 6E capital action)
 * cannot rewrite what a run already spent.
 */
export async function getRun(runId: number): Promise<RunSummary> {
  const [run] = await db
    .select()
    .from(simulationRuns)
    .where(eq(simulationRuns.id, runId));
  if (!run) throw new HttpError(404, `Run ${runId} not found`);

  const [wip] = await db
    .select({ count: count() })
    .from(runWipParts)
    .where(eq(runWipParts.runId, runId));

  const [finished] = await db
    .select({ count: count(), throughputCents: sum(runFinishedParts.throughputCents) })
    .from(runFinishedParts)
    .where(eq(runFinishedParts.runId, runId));

  const [expense] = await db
    .select({
      operatingExpenseCents: sum(runTicks.operatingExpenseCents),
      carryingCostCents: sum(runTicks.carryingCostCents),
    })
    .from(runTicks)
    .where(eq(runTicks.runId, runId));

  const releasedOrders = await db
    .select({
      workOrderId: runReleasedOrders.workOrderId,
      routingId: runReleasedOrders.routingId,
      routingRevision: runReleasedOrders.routingRevision,
    })
    .from(runReleasedOrders)
    .where(eq(runReleasedOrders.runId, runId))
    .orderBy(runReleasedOrders.workOrderId);

  // sum() is null over no rows, and arrives as a string from the driver
  const throughputCents = Number(finished?.throughputCents ?? 0);
  const operatingExpenseCents = Number(expense?.operatingExpenseCents ?? 0);
  const carryingCostCents = Number(expense?.carryingCostCents ?? 0);

  return {
    ...run,
    wipCount: Number(wip?.count ?? 0),
    finishedCount: Number(finished?.count ?? 0),
    throughputCents,
    operatingExpenseCents,
    carryingCostCents,
    netCents: throughputCents - operatingExpenseCents - carryingCostCents,
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
  netCents: number;
  flow: MetricsAggregate;
  cycleTime: CycleTimeAggregate;
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

  const { from, to } = tickWindow(fromTick, toTick, run.tickNum);

  const tickRows = await db
    .select()
    .from(runTicks)
    .where(
      and(
        eq(runTicks.runId, runId),
        gte(runTicks.tickNum, from),
        lte(runTicks.tickNum, to),
      ),
    )
    .orderBy(runTicks.tickNum);

  const centerRows = await db
    .select()
    .from(runTickWorkCenters)
    .where(
      and(
        eq(runTickWorkCenters.runId, runId),
        gte(runTickWorkCenters.tickNum, from),
        lte(runTickWorkCenters.tickNum, to),
      ),
    );

  const finished = await db
    .select()
    .from(runFinishedParts)
    .where(
      and(
        eq(runFinishedParts.runId, runId),
        gte(runFinishedParts.completedAtTick, from),
        lte(runFinishedParts.completedAtTick, to),
      ),
    )
    .orderBy(runFinishedParts.completedAtTick, runFinishedParts.id);

  const storedCenters = await db
    .select({
      workCenterId: runWorkCenters.workCenterId,
      capacity: runWorkCenters.capacity,
    })
    .from(runWorkCenters)
    .where(eq(runWorkCenters.runId, runId))
    .orderBy(runWorkCenters.workCenterId);

  const centersByTick = new Map<number, TickWorkCenterMetrics[]>();
  for (const row of centerRows) {
    const entry = {
      workCenterId: row.workCenterId,
      busy: row.busy,
      queued: row.queued,
    };
    const list = centersByTick.get(row.tickNum);
    if (list) list.push(entry);
    else centersByTick.set(row.tickNum, [entry]);
  }

  const series: TickMetrics[] = tickRows.map((row) => ({
    tickNum: row.tickNum,
    wipCount: row.wipCount,
    workCenters: centersByTick.get(row.tickNum) ?? [],
  }));

  const throughputCents = tickRows.reduce(
    (total, row) => total + row.throughputCents,
    0,
  );
  const operatingExpenseCents = tickRows.reduce(
    (total, row) => total + row.operatingExpenseCents,
    0,
  );
  const carryingCostCents = tickRows.reduce(
    (total, row) => total + row.carryingCostCents,
    0,
  );

  return {
    fromTick: from,
    toTick: to,
    throughputCents,
    operatingExpenseCents,
    carryingCostCents,
    netCents: throughputCents - operatingExpenseCents - carryingCostCents,
    flow: aggregateMetrics(
      series,
      new Map(
        storedCenters.map((center) => [
          center.workCenterId,
          { id: center.workCenterId, capacity: center.capacity },
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
  };
}

export type RunFloor = {
  tickNum: number;
  wipCount: number;
  workCenters: (WorkCenterFloorView & {
    name: string;
    capacity: number;
    /** frozen, like capacity — what this run's centre costs per calendar day */
    standingCostCentsPerDay: number;
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

  const state = await loadRunState(run);

  const names = new Map(
    (await db
      .select({ id: workCenters.id, name: workCenters.name })
      .from(workCenters)).map((center) => [center.id, center.name]),
  );

  const view = deriveFloorView(
    state.wipParts,
    state.routingByWorkOrder,
    state.workCenters,
  );

  return {
    tickNum: run.tickNum,
    wipCount: state.wipParts.length,
    workCenters: view.map((center) => ({
      ...center,
      name: names.get(center.workCenterId) ?? `Work center ${center.workCenterId}`,
      capacity: state.workCenters.get(center.workCenterId)?.capacity ?? 0,
      standingCostCentsPerDay:
        state.costs.standingCostByWorkCenter.get(center.workCenterId) ?? 0,
    })),
  };
}

export type TickSeriesRow = {
  tickNum: number;
  throughputCents: number;
  wipCount: number;
  operatingExpenseCents: number;
  carryingCostCents: number;
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
  const inWindow = and(
    eq(runTicks.runId, runId),
    gte(runTicks.tickNum, from),
    lte(runTicks.tickNum, to),
  );

  if (bucket <= 1) {
    const rows = await db
      .select({
        tickNum: runTicks.tickNum,
        throughputCents: runTicks.throughputCents,
        wipCount: runTicks.wipCount,
        operatingExpenseCents: runTicks.operatingExpenseCents,
        carryingCostCents: runTicks.carryingCostCents,
      })
      .from(runTicks)
      .where(inWindow)
      .orderBy(desc(runTicks.tickNum))
      .limit(MAX_TICK_SERIES_ROWS);

    // read newest-first to cap at the end of the window, handed back in order
    return rows.reverse();
  }

  // integer division on int columns — Postgres truncates, which is the floor
  // for the non-negative tick numbers involved. The bucket is inlined rather
  // than bound: GROUP BY and ORDER BY must be the *same expression*, and two
  // occurrences of a bind parameter are two expressions to Postgres. Safe —
  // zod has already proven it a positive integer, and the floor re-proves it.
  const bucketGroup = sql`(${runTicks.tickNum} - 1) / ${sql.raw(String(Math.floor(bucket)))}`;
  const rows = await db
    .select({
      tickNum: sql<number>`max(${runTicks.tickNum})`,
      throughputCents: sql<number>`sum(${runTicks.throughputCents})::int`,
      wipCount: sql<number>`(array_agg(${runTicks.wipCount} order by ${runTicks.tickNum} desc))[1]`,
      operatingExpenseCents: sql<number>`sum(${runTicks.operatingExpenseCents})::int`,
      carryingCostCents: sql<number>`sum(${runTicks.carryingCostCents})::int`,
    })
    .from(runTicks)
    .where(inWindow)
    .groupBy(bucketGroup)
    .orderBy(sql`${bucketGroup} desc`)
    .limit(MAX_TICK_SERIES_ROWS);

  return rows.reverse().map((row) => ({
    tickNum: Number(row.tickNum),
    throughputCents: Number(row.throughputCents),
    wipCount: Number(row.wipCount),
    operatingExpenseCents: Number(row.operatingExpenseCents),
    carryingCostCents: Number(row.carryingCostCents),
  }));
}
