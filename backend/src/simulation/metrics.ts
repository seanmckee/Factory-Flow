import type { TickMetrics } from "./simulationTick.js";
import type { FinishedPart, WorkCenter } from "./types.js";

/**
 * How one work center behaved over a window of ticks.
 *
 * The frontend's card view reports utilization as `slotsInUse / capacity` at a
 * single instant, so it can only ever read 0, ½ or 1. That answers "is the
 * drill press busy right now", which is a display question. The agent asks "how
 * busy was the drill press over the last 500 ticks", and only a window can
 * answer it.
 */
export type WorkCenterAggregate = {
  workCenterId: number;
  /**
   * Busy machine-ticks ÷ (capacity × observed ticks), in `[0, 1]`. 1 means
   * every machine ran every tick — the signature of the constraint.
   */
  utilization: number;
  /** Machine-ticks actually worked, the numerator above, kept for auditing. */
  busyMachineTicks: number;
  /** Mean parts waiting at this center per tick. */
  meanQueueDepth: number;
  /** The worst it got in the window — a mean hides the pile-up that caused it. */
  maxQueueDepth: number;
  /**
   * Ticks in the window that reported this center at all, which is the
   * denominator above rather than `tickCount`. A center created mid-run has no
   * observations before it existed, and dividing those in would report it as
   * idle for time it did not exist.
   */
  observedTicks: number;
};

/** A window of ticks, reduced. */
export type MetricsAggregate = {
  /** Bounds of the window, or null when it contains no ticks. */
  fromTick: number | null;
  toTick: number | null;
  tickCount: number;
  /** Mean parts on the floor per tick. */
  meanWip: number;
  /** The peak — Phase 7 names "WIP ballooned" as an outcome to explain. */
  maxWip: number;
  /** Parts on the floor at the end of the window. */
  finalWip: number;
  /**
   * One entry per work center passed in, in that map's order, whether or not
   * the window ever saw it — the same rule the tick applies, so a chart's rows
   * don't appear and vanish as a center goes idle.
   */
  workCenters: WorkCenterAggregate[];
};

/**
 * Reduce a window of per-tick observations to rates.
 *
 * `series` must be in tick order; storage returns it that way and an in-memory
 * batch is built that way. Windowing is the caller's job — a `WHERE tick_num
 * BETWEEN` or a slice — so this aggregates exactly what it is handed.
 *
 * An empty window is not an error: a run that has never advanced legitimately
 * has no ticks. It reports zeroes, null bounds, and every center still listed.
 */
export function aggregateMetrics(
  series: TickMetrics[],
  workCenters: Map<number, WorkCenter>,
): MetricsAggregate {
  const busyMachineTicks = new Map<number, number>();
  const queuedPartTicks = new Map<number, number>();
  const maxQueueDepth = new Map<number, number>();
  const observedTicks = new Map<number, number>();

  let wipTotal = 0;
  let maxWip = 0;

  for (const tick of series) {
    wipTotal += tick.wipCount;
    maxWip = Math.max(maxWip, tick.wipCount);

    for (const observation of tick.workCenters) {
      const id = observation.workCenterId;
      if (!workCenters.has(id)) {
        throw new Error(
          `Tick ${tick.tickNum} reports work center ${id}, which was not loaded`,
        );
      }
      observedTicks.set(id, (observedTicks.get(id) ?? 0) + 1);
      busyMachineTicks.set(id, (busyMachineTicks.get(id) ?? 0) + observation.busy);
      queuedPartTicks.set(id, (queuedPartTicks.get(id) ?? 0) + observation.queued);
      maxQueueDepth.set(
        id,
        Math.max(maxQueueDepth.get(id) ?? 0, observation.queued),
      );
    }
  }

  const tickCount = series.length;
  const first = series[0];
  const last = series[tickCount - 1];

  return {
    fromTick: first?.tickNum ?? null,
    toTick: last?.tickNum ?? null,
    tickCount,
    meanWip: tickCount === 0 ? 0 : wipTotal / tickCount,
    maxWip,
    finalWip: last?.wipCount ?? 0,
    workCenters: [...workCenters.values()].map((workCenter) => {
      const observed = observedTicks.get(workCenter.id) ?? 0;
      const busy = busyMachineTicks.get(workCenter.id) ?? 0;
      const machineTicks = observed * workCenter.capacity;
      return {
        workCenterId: workCenter.id,
        utilization: machineTicks === 0 ? 0 : busy / machineTicks,
        busyMachineTicks: busy,
        meanQueueDepth:
          observed === 0 ? 0 : (queuedPartTicks.get(workCenter.id) ?? 0) / observed,
        maxQueueDepth: maxQueueDepth.get(workCenter.id) ?? 0,
        observedTicks: observed,
      };
    }),
  };
}

/**
 * How long parts took to get through the shop.
 *
 * Every field is null when nothing finished, rather than zero as
 * `aggregateMetrics` reports its rates. The difference is deliberate: a work
 * center that did no work genuinely was 0% utilized, but "no parts finished"
 * does not mean cycle time was zero — and zero is itself reachable, since a
 * part stranded by a shortened routing finishes on the tick it is seen.
 */
export type CycleTimeAggregate = {
  /** Parts the aggregate is over. */
  count: number;
  meanSeconds: number | null;
  minSeconds: number | null;
  maxSeconds: number | null;
  /**
   * Nearest-rank percentiles, no interpolation: the value at
   * `ceil(p × count)` in sorted order, so both are always a cycle time some
   * part actually had. The median is the typical part; the 95th is the tail
   * that misses a due date, which is the half a mean hides.
   */
  medianSeconds: number | null;
  p95Seconds: number | null;
};

/**
 * Cycle time per part is `completedAtTick - releasedAtTick`, one tick being one
 * simulated second. It counts queueing, not just processing — a part waiting
 * its turn is accruing cycle time and, from Track 6, carrying cost.
 *
 * Windowing is the caller's job, as in `aggregateMetrics`: filter by
 * `completedAtTick` and hand over what falls inside. The two windows are
 * independent, since finished parts are an append-only series of their own.
 */
export function aggregateCycleTime(
  finishedParts: FinishedPart[],
): CycleTimeAggregate {
  const cycleTimes: number[] = [];
  let total = 0;

  for (const part of finishedParts) {
    const cycleTime = part.completedAtTick - part.releasedAtTick;
    if (cycleTime < 0) {
      throw new Error(
        `Part ${part.id} finished at tick ${part.completedAtTick}, before it was released at ${part.releasedAtTick}`,
      );
    }
    cycleTimes.push(cycleTime);
    total += cycleTime;
  }

  const count = cycleTimes.length;
  if (count === 0) {
    return {
      count: 0,
      meanSeconds: null,
      minSeconds: null,
      maxSeconds: null,
      medianSeconds: null,
      p95Seconds: null,
    };
  }

  cycleTimes.sort((a, b) => a - b);
  return {
    count,
    meanSeconds: total / count,
    minSeconds: cycleTimes[0] ?? null,
    maxSeconds: cycleTimes[count - 1] ?? null,
    medianSeconds: percentile(cycleTimes, 0.5),
    p95Seconds: percentile(cycleTimes, 0.95),
  };
}

/** Nearest rank over an already-sorted, non-empty list. */
function percentile(sorted: number[], fraction: number): number | null {
  const rank = Math.ceil(fraction * sorted.length);
  return sorted[Math.max(0, rank - 1)] ?? null;
}
