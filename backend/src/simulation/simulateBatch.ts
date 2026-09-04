import { creditFinishedParts } from "./calculateThroughput.js";
import {
  accrueCarrying,
  materialCostByWorkOrder,
  timeExpenseAtTick,
  wipMaterialValueCents,
  type CostRates,
} from "./operatingExpense.js";
import {
  setupKey,
  simulateTick,
  type TickWorkCenterMetrics,
} from "./simulationTick.js";
import type {
  Allocation,
  Part,
  Routing,
  SalesOrder,
  WipPart,
  WorkCenter,
  WorkOrder,
} from "./types.js";

/**
 * Everything a run needs to advance, loaded once. The config half is the run's
 * own — `routingByWorkOrder` from its pinned steps and `workCenters` from its
 * frozen capacities, never the live tables — which is what lets two runs
 * disagree about the same factory.
 */
export type RunState = {
  /** ticks already advanced; the batch starts at `tickNum + 1` */
  tickNum: number;
  rngSeed: number;
  wipParts: WipPart[];
  /** keyed by work order id: each release pinned its own copy of the steps */
  routingByWorkOrder: Map<number, Routing>;
  workCenters: Map<number, WorkCenter>;
  workOrders: WorkOrder[];
  parts: Part[];
  salesOrders: SalesOrder[];
  allocations: Allocation[];
  /** the run's frozen rates; a free factory is all zeroes, not an absence */
  costs: CostRates;
  /** carrying cost's sub-cent remainder as persisted; see `accrueCarrying` */
  carryRemainder: number;
  /**
   * (work order, step) pairs whose changeover was already paid, keyed by
   * `setupKey` — loaded from `run_work_order_steps.setup_started_at_tick`.
   * Persisted rather than derived, because whether setup was paid must
   * survive a batch boundary and the paying unit may since have scrapped out
   * of the very step it set up.
   */
  setupDone: ReadonlySet<string>;
  /**
   * Work order id -> units of it finished before this batch. Loaded as a
   * `GROUP BY` rather than by counting a list, so advancing a long run never
   * reads its whole finished history back.
   */
  priorCounts: Map<number, number>;
};

/** A finished unit as it is stored: the part, the tick, and the frozen money. */
export type FinishedPartRecord = {
  partId: string;
  workOrderId: number;
  releasedAtTick: number;
  completedAtTick: number;
  throughputCents: number;
  salesOrderId: number | null;
  unitPriceCents: number | null;
  materialCostCents: number;
  /** frozen at credit time; null for an uncovered unit or an undated order */
  dueAtTick: number | null;
};

/** One tick's row, with the per-center rows that hang off it. */
export type TickRecord = {
  tickNum: number;
  throughputCents: number;
  wipCount: number;
  /** standing costs + facility overhead accrued this tick, frozen cents */
  operatingExpenseCents: number;
  /** holding charge on this tick's end-of-tick WIP */
  carryingCostCents: number;
  workCenters: TickWorkCenterMetrics[];
};

/**
 * The whole result of a batch: what to write, and what to carry into the next
 * one. Nothing here is persisted yet — that is the caller's single transaction.
 */
export type RunBatch = {
  /** the run's tick number after the batch */
  tickNum: number;
  /** the survivors, replacing the stored set wholesale */
  wipParts: WipPart[];
  /** append-only */
  finishedParts: FinishedPartRecord[];
  ticks: TickRecord[];
  /**
   * `priorCounts` advanced by what finished, so a long advance can run as
   * several batches without re-reading the counts between them.
   */
  priorCounts: Map<number, number>;
  /** the carrying fold's remainder after the batch, carried out the same way */
  carryRemainder: number;
  /** `setupDone` advanced by the batch's changeovers, carried like the counts */
  setupDone: ReadonlySet<string>;
  /**
   * The changeovers that began in this batch, for the caller to freeze into
   * `run_work_order_steps.setup_started_at_tick` — only the delta, so the
   * write stays a handful of rows however long the batch ran.
   */
  setupsStarted: SetupStartRecord[];
};

/** One changeover as it is stored: the pinned step row it marks, and when. */
export type SetupStartRecord = {
  workOrderId: number;
  stepIndex: number;
  atTick: number;
};

/**
 * Advances a run `ticks` ticks in memory and returns everything to persist.
 *
 * This is the whole of what advancing means, kept pure: the run service around
 * it only loads a `RunState`, calls this, and writes the `RunBatch` in one
 * transaction. Per-tick writes would make a Neon round trip out of every
 * simulated second and put a fast-forward of thousands of ticks out of reach.
 *
 * Money is credited per finished part rather than per tick, because two parts
 * finishing in one tick can be covered by different allocations and so sell at
 * different prices. The tick's `throughputCents` is the sum of its parts'.
 *
 * `priorCounts` advances *within* the batch, so a unit finishing at tick 5 is
 * priced against the allocation after the one that covered a unit finishing at
 * tick 3. It is copied rather than mutated, so a caller's map is left alone.
 */
export function simulateBatch(state: RunState, ticks: number): RunBatch {
  if (ticks < 0) {
    throw new Error(`Cannot advance a run by ${ticks} ticks`);
  }

  const priorCounts = new Map(state.priorCounts);
  const setupDone = new Set(state.setupDone);
  const setupsStarted: SetupStartRecord[] = [];
  const finishedParts: FinishedPartRecord[] = [];
  const tickRecords: TickRecord[] = [];
  let wipParts = state.wipParts;
  let carryRemainder = state.carryRemainder;
  const costByWorkOrder = materialCostByWorkOrder(state.workOrders, state.parts);

  for (let offset = 1; offset <= ticks; offset++) {
    const tickNum = state.tickNum + offset;

    const result = simulateTick(
      wipParts,
      state.routingByWorkOrder,
      tickNum,
      state.workCenters,
      state.rngSeed,
      setupDone,
    );

    for (const started of result.setupsStarted) {
      setupDone.add(setupKey(started.workOrderId, started.stepIndex));
      setupsStarted.push({ ...started, atTick: tickNum });
    }

    const credits = creditFinishedParts(
      result.finishedParts,
      priorCounts,
      state.workOrders,
      state.parts,
      state.salesOrders,
      state.allocations,
    );

    // the credit knows the money, the finished part knows the ticks
    const releasedAtTick = new Map(
      result.finishedParts.map((part) => [part.id, part.releasedAtTick]),
    );

    let throughputCents = 0;
    for (const credit of credits) {
      const released = releasedAtTick.get(credit.partId);
      if (released === undefined) {
        throw new Error(
          `Credit for part ${credit.partId} has no finished part in tick ${tickNum}`,
        );
      }

      throughputCents += credit.throughputCents;
      priorCounts.set(
        credit.workOrderId,
        (priorCounts.get(credit.workOrderId) ?? 0) + 1,
      );
      finishedParts.push({
        partId: credit.partId,
        workOrderId: credit.workOrderId,
        releasedAtTick: released,
        completedAtTick: tickNum,
        throughputCents: credit.throughputCents,
        salesOrderId: credit.salesOrderId,
        unitPriceCents: credit.unitPriceCents,
        materialCostCents: credit.materialCostCents,
        dueAtTick: credit.dueAtTick,
      });
    }

    // carrying charges the end-of-tick floor — the set `wipCount` counts — so
    // a part that finished during the tick pays no rent for it
    const carrying = accrueCarrying(
      wipMaterialValueCents(result.wipParts, costByWorkOrder),
      state.costs.wipCarryingBpsPerDay,
      state.costs.dayTicks,
      carryRemainder,
    );
    carryRemainder = carrying.carryRemainder;

    tickRecords.push({
      tickNum,
      throughputCents,
      wipCount: result.metrics.wipCount,
      operatingExpenseCents: timeExpenseAtTick(state.costs, tickNum),
      carryingCostCents: carrying.carryingCostCents,
      workCenters: result.metrics.workCenters,
    });

    wipParts = result.wipParts;
  }

  return {
    tickNum: state.tickNum + ticks,
    wipParts,
    finishedParts,
    ticks: tickRecords,
    priorCounts,
    carryRemainder,
    setupDone,
    setupsStarted,
  };
}
