import type { TickMetrics } from "./simulationTick.js";

/**
 * Ticks per stored observation bucket — one simulated minute.
 *
 * A **constant**, not frozen per run like `day_ticks`. Two reasons, and they
 * pull the same way: Track 7 compares two runs' observations, which requires
 * them bucketed identically, and a constant makes that structural rather than
 * something a comparison has to check; and `day_ticks` is frozen because
 * shifts change what a run's money *means*, where observation resolution is a
 * storage detail that changes nothing about the run. `GET /:id/ticks?bucket=N`
 * already coarsens further at read time, so per-run width would buy only what
 * the read path offers anyway.
 */
export const TICKS_PER_BUCKET = 60;

/**
 * One work center's share of a bucket. Every field is a **sum, a count or a
 * max** — never a mean — because that is exactly what makes the bucket lossless
 * for `aggregateMetrics`: a mean would have to divide here and again there, and
 * dividing twice is where resolution is actually lost.
 */
export type BucketWorkCenterMetrics = {
  workCenterId: number;
  /**
   * Ticks in this bucket that observed this center at all. The mean-queue
   * denominator, and what keeps a center created mid-run from being reported
   * idle for time it did not exist — Track 2.2's rule, carried into the bucket.
   */
  observedTicks: number;
  /** Σ busy machines over this bucket's ticks. */
  busyMachineTicks: number;
  /**
   * Σ effective capacity over this bucket's ticks — the utilization
   * denominator. Summed per observation rather than `observedTicks × capacity`,
   * because 6E moves capacity mid-run and a bucket can span the move.
   */
  capacityTicks: number;
  /** Σ parts waiting over this bucket's ticks. */
  queuedPartTicks: number;
  /** The worst single tick in the bucket — a sum cannot recover a peak. */
  maxQueueDepth: number;
};

/**
 * A window of consecutive ticks, reduced to what every reported figure is
 * built from. Storage keeps one row per bucket instead of one per tick, which
 * is 60× fewer rows on both the write and the read; a bucket also *is* the
 * shape a single tick reduces to, so a per-tick series and a stored series
 * aggregate through one code path.
 *
 * WIP needs three fields rather than one because it is a **level**, not a
 * flow: `wipPartTicks` is what a mean divides, `maxWip` is a peak no sum can
 * recover, and `endWip` is the level the window ends on. Keeping only the last
 * of those — the first sketch of this change — would have made `meanWip` and
 * `maxWip` approximations, which is the one thing this change must not do.
 */
export type ObservationBucket = {
  /**
   * First tick of the bucket's slot on the grid, `index × width + 1` — the
   * storage key, and the bucket's own `fromTick`. Ticks number from 1, so the
   * first bucket of a run covers ticks 1…width.
   */
  startTick: number;
  /**
   * Ticks actually observed in it. Below the width for the newest bucket of a
   * run advanced by a number of ticks the width does not divide — such a bucket
   * is completed by the *next* advance, which is why storage accumulates into
   * it rather than inserting it.
   */
  tickCount: number;
  /** Σ parts on the floor over this bucket's ticks; the mean-WIP numerator. */
  wipPartTicks: number;
  maxWip: number;
  /** Parts on the floor at the last observed tick of the bucket. */
  endWip: number;
  workCenters: BucketWorkCenterMetrics[];
};

/** The last tick a bucket observed. Observed ticks fill a bucket in order. */
export function bucketLastTick(bucket: ObservationBucket): number {
  return bucket.startTick + bucket.tickCount - 1;
}

/**
 * Group a tick-ordered series of observations onto the bucket grid.
 *
 * `series` must be in ascending tick order — storage returns it that way and a
 * batch is built that way — and a series that goes backwards **throws**, as a
 * corrupt run rather than a re-order to paper over: the project's rule since
 * 1.2 is that a referenced-but-impossible observation fails loudly, because a
 * silently mis-bucketed series reads as a policy that behaved oddly rather than
 * as a bug.
 *
 * Bucketing at width 1 is the identity in every figure that matters, which is
 * what lets one aggregate serve a live batch, a stored series and a test's
 * hand-built ticks.
 */
export function bucketTicks(
  series: TickMetrics[],
  width: number,
): ObservationBucket[] {
  if (!Number.isInteger(width) || width < 1) {
    throw new Error(`Bucket width must be a positive whole number, got ${width}`);
  }

  const buckets: ObservationBucket[] = [];
  // per-bucket work-center accumulators, held beside the bucket being filled
  let centers = new Map<number, BucketWorkCenterMetrics>();
  let current: ObservationBucket | undefined;
  let currentIndex = -1;
  let previousTick = -Infinity;

  for (const tick of series) {
    if (tick.tickNum <= previousTick) {
      throw new Error(
        `Observation series is out of order: tick ${tick.tickNum} follows ${previousTick}`,
      );
    }
    previousTick = tick.tickNum;

    const index = Math.floor((tick.tickNum - 1) / width);
    if (!current || index !== currentIndex) {
      centers = new Map();
      current = {
        startTick: index * width + 1,
        tickCount: 0,
        wipPartTicks: 0,
        maxWip: 0,
        endWip: 0,
        workCenters: [],
      };
      buckets.push(current);
      currentIndex = index;
    }

    current.tickCount += 1;
    current.wipPartTicks += tick.wipCount;
    current.maxWip = Math.max(current.maxWip, tick.wipCount);
    // ticks arrive in order, so the newest one seen is the bucket's end
    current.endWip = tick.wipCount;

    for (const observation of tick.workCenters) {
      let center = centers.get(observation.workCenterId);
      if (!center) {
        center = {
          workCenterId: observation.workCenterId,
          observedTicks: 0,
          busyMachineTicks: 0,
          capacityTicks: 0,
          queuedPartTicks: 0,
          maxQueueDepth: 0,
        };
        // the map holds the very objects the bucket's array does, so
        // accumulating through the map advances what the bucket carries
        centers.set(observation.workCenterId, center);
        current.workCenters.push(center);
      }
      center.observedTicks += 1;
      center.busyMachineTicks += observation.busy;
      center.capacityTicks += observation.capacity;
      center.queuedPartTicks += observation.queued;
      center.maxQueueDepth = Math.max(center.maxQueueDepth, observation.queued);
    }
  }

  return buckets;
}
