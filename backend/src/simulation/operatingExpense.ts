import type { Part, WipPart, WorkOrder } from "./types.js";

/**
 * Operating expense: the time-based costs (facility overhead, per-centre
 * standing cost) and the carrying charge on WIP. All rates are entered per
 * **calendar day** and amortized over the day's staffed ticks — `dayTicks` is
 * one 8-hour shift of one-second ticks today, and a second shift (Track 6D)
 * lengthens the day rather than reinterpreting the tick.
 */
export const TICKS_PER_DAY = 28_800;

/** The run's frozen cost config, loaded beside its capacities. */
export type CostRates = {
  dayTicks: number;
  facilityOverheadCentsPerDay: number;
  /** basis points of on-floor material value per day (100 = 1%/day) */
  wipCarryingBpsPerDay: number;
  /** frozen per-centre standing cost, cents/day, keyed by work center id */
  standingCostByWorkCenter: Map<number, number>;
};

/**
 * The integer cents a per-day rate accrues at tick `t`:
 * `floor(t·r/D) − floor((t−1)·r/D)`. A pure function of the tick number, so
 * batch splitting reproduces it with no cursor — the same property as the RNG —
 * and any full day sums to exactly `r`.
 */
export function accrueRate(
  rate: number,
  tickNum: number,
  dayTicks: number,
): number {
  if (rate < 0) throw new Error(`Cannot accrue a negative rate ${rate}`);
  if (dayTicks < 1) throw new Error(`A day of ${dayTicks} ticks is not a day`);
  return (
    Math.floor((tickNum * rate) / dayTicks) -
    Math.floor(((tickNum - 1) * rate) / dayTicks)
  );
}

/**
 * Facility overhead plus every centre's standing cost at tick `t` — accrued
 * **per rate** and summed, never on the summed rate: floor diffs on a combined
 * rate disagree with the sum of the parts mid-day, and the stored tick total
 * must equal any per-centre breakdown by construction, the way
 * `calculateThroughput` is the sum of `creditFinishedParts`.
 */
export function timeExpenseAtTick(rates: CostRates, tickNum: number): number {
  let cents = accrueRate(
    rates.facilityOverheadCentsPerDay,
    tickNum,
    rates.dayTicks,
  );
  for (const standingCost of rates.standingCostByWorkCenter.values()) {
    cents += accrueRate(standingCost, tickNum, rates.dayTicks);
  }
  return cents;
}

/**
 * What one rate accrues over `[fromTick, toTick]`, in O(1): the per-tick
 * accruals telescope to `floor(to·r/D) − floor((from−1)·r/D)`.
 */
export function rateWindowCents(
  rate: number,
  fromTick: number,
  toTick: number,
  dayTicks: number,
): number {
  if (toTick < fromTick) {
    throw new Error(`Window ${fromTick}..${toTick} is backwards`);
  }
  if (rate < 0) throw new Error(`Cannot accrue a negative rate ${rate}`);
  if (dayTicks < 1) throw new Error(`A day of ${dayTicks} ticks is not a day`);
  return (
    Math.floor((toTick * rate) / dayTicks) -
    Math.floor(((fromTick - 1) * rate) / dayTicks)
  );
}

/**
 * Work order id → the material cost of the part it makes. Built once per
 * batch; a missing part throws, as everywhere in the engine — a silent zero
 * would read as WIP that is free to hold.
 */
export function materialCostByWorkOrder(
  workOrders: WorkOrder[],
  parts: Part[],
): Map<number, number> {
  const partById = new Map(parts.map((part) => [part.id, part]));
  const costByWorkOrder = new Map<number, number>();
  for (const workOrder of workOrders) {
    const part = partById.get(workOrder.partId);
    if (!part) {
      throw new Error(
        `Work order ${workOrder.id} makes part ${workOrder.partId}, which was not loaded`,
      );
    }
    costByWorkOrder.set(workOrder.id, part.materialCostCents);
  }
  return costByWorkOrder;
}

/** The material cents sitting on the floor. Throws on an unloaded work order. */
export function wipMaterialValueCents(
  wipParts: WipPart[],
  costByWorkOrder: Map<number, number>,
): number {
  let cents = 0;
  for (const part of wipParts) {
    const cost = costByWorkOrder.get(part.workOrderId);
    if (cost === undefined) {
      throw new Error(
        `Part ${part.id} belongs to work order ${part.workOrderId}, which was not loaded`,
      );
    }
    cents += cost;
  }
  return cents;
}

export type CarryingAccrual = {
  carryingCostCents: number;
  /** always in [0, 10000 · dayTicks); persist and thread into the next tick */
  carryRemainder: number;
};

/**
 * One tick's holding charge on `wipValueCents` of material. Unlike the
 * time-based rates this depends on what sat on the floor, so it is a fold with
 * a remainder rather than a function of the tick number: numerator units are
 * `cents · bps`, a whole day of them per cent charged (`K = 10000 · dayTicks`).
 *
 * The fold is exact, not drifting — with `0 ≤ r < K` invariant, the lifetime
 * total is `floor(Σ V(t)·c / K)` however the run was chunked — and resuming
 * from a persisted remainder reproduces the identical charge stream, which is
 * what lets a batch boundary land anywhere.
 */
export function accrueCarrying(
  wipValueCents: number,
  wipCarryingBpsPerDay: number,
  dayTicks: number,
  carryRemainder: number,
): CarryingAccrual {
  if (wipValueCents < 0) {
    throw new Error(`WIP cannot be worth ${wipValueCents} cents`);
  }
  if (wipCarryingBpsPerDay < 0) {
    throw new Error(
      `Cannot accrue a negative carrying rate ${wipCarryingBpsPerDay}`,
    );
  }
  if (dayTicks < 1) throw new Error(`A day of ${dayTicks} ticks is not a day`);
  const scale = 10_000 * dayTicks;
  if (carryRemainder < 0 || carryRemainder >= scale) {
    throw new Error(
      `Carry remainder ${carryRemainder} is outside [0, ${scale})`,
    );
  }

  const numerator = carryRemainder + wipValueCents * wipCarryingBpsPerDay;
  return {
    carryingCostCents: Math.floor(numerator / scale),
    carryRemainder: numerator % scale,
  };
}
