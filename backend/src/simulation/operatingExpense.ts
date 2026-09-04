import type { Part, WipPart, WorkOrder } from "./types.js";

/**
 * Operating expense: the time-based costs (facility overhead, per-centre
 * standing cost) and the carrying charge on WIP. All rates are entered per
 * **calendar day** and amortized over the day's staffed ticks — `dayTicks` is
 * one 8-hour shift of one-second ticks today, and a second shift (Track 6D)
 * lengthens the day rather than reinterpreting the tick.
 */
export const TICKS_PER_DAY = 28_800;

/** Ticks in a staffed hour — the denominator wages accrue over. */
export const TICKS_PER_HOUR = 3_600;

/**
 * A rate with the tick its amortization is measured from. Capital actions (6E)
 * change a centre's rates mid-run, and a per-period rate has to know which
 * period it is in: the accrual counts ticks from `sinceTick`, so each segment
 * charges exactly the floor of its own duration × rate.
 *
 * `sinceTick: 0` means "since the run began", which is what every rate no
 * capital action has touched carries — and so is the pre-6E accrual byte for
 * byte.
 */
export type DatedRate = {
  /**
   * Cents per the denominator of the map it sits in: a calendar day for
   * standing cost, a staffed hour for wages.
   */
  cents: number;
  sinceTick: number;
};

/** The run's frozen cost config, loaded beside its capacities. */
export type CostRates = {
  dayTicks: number;
  /**
   * Facility overhead is undated: it is frozen at creation and no capital
   * action touches it, a centre being the only thing 6E can buy into or out
   * of. If a facility-level action ever lands, this becomes a `DatedRate` too.
   */
  facilityOverheadCentsPerDay: number;
  /** basis points of on-floor material value per day (100 = 1%/day) */
  wipCarryingBpsPerDay: number;
  /**
   * The centre's whole daily standing cost, keyed by work center id — the
   * loader pre-multiplies the frozen per-machine rate by the machine count, so
   * the engine sums rates without knowing what a machine is.
   */
  standingCostByWorkCenter: Map<number, DatedRate>;
  /**
   * The centre's whole hourly wage bill, keyed by work center id — the loader
   * pre-multiplies the frozen per-operator rate by the operator count, so the
   * engine sums rates without knowing about operators. Per staffed hour, not
   * per calendar day: that denominator is what makes a second shift double the
   * day's wages while amortizing the same rent.
   */
  wageCentsPerHourByWorkCenter: Map<number, DatedRate>;
};

/**
 * The integer cents a per-day rate accrues at tick `t`, counting from the tick
 * the rate took effect: `floor((t−t₀)·r/D) − floor((t−1−t₀)·r/D)`. Still a
 * pure function of the tick number, so batch splitting reproduces it with no
 * cursor — the same property as the RNG — and any full day *inside one
 * segment* sums to exactly `r`.
 *
 * A rate charges from `sinceTick + 1` onward and nothing before it, so the
 * default of 0 charges from the run's first tick: that is the whole of the
 * pre-6E behaviour, unchanged.
 */
export function accrueRate(
  rate: number,
  tickNum: number,
  dayTicks: number,
  sinceTick = 0,
): number {
  if (rate < 0) throw new Error(`Cannot accrue a negative rate ${rate}`);
  if (dayTicks < 1) throw new Error(`A day of ${dayTicks} ticks is not a day`);
  if (sinceTick < 0) {
    throw new Error(`A rate cannot take effect at tick ${sinceTick}`);
  }
  // a rate in effect from t₀ charges nothing at or before it — and the floor
  // diff of a negative elapsed count would charge a spurious cent, since
  // `Math.floor` of a negative share rounds away from zero
  if (tickNum <= sinceTick) return 0;
  const elapsed = tickNum - sinceTick;
  return (
    Math.floor((elapsed * rate) / dayTicks) -
    Math.floor(((elapsed - 1) * rate) / dayTicks)
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
    cents += accrueRate(
      standingCost.cents,
      tickNum,
      rates.dayTicks,
      standingCost.sinceTick,
    );
  }
  return cents;
}

/**
 * Every centre's wage bill at tick `t`, accrued per rate over the staffed
 * hour and then summed — the same never-on-the-summed-rate rule as
 * `timeExpenseAtTick`, so the stored tick total equals any per-centre
 * breakdown by construction. Wages are a pure function of the tick number
 * like the other time rates: an operator is paid for staffed time whether or
 * not the machine runs, which is what makes an idle staffed factory a money
 * furnace.
 */
export function wagesAtTick(rates: CostRates, tickNum: number): number {
  let cents = 0;
  for (const hourly of rates.wageCentsPerHourByWorkCenter.values()) {
    cents += accrueRate(
      hourly.cents,
      tickNum,
      TICKS_PER_HOUR,
      hourly.sinceTick,
    );
  }
  return cents;
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
