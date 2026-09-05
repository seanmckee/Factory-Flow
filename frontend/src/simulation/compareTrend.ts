import type { ThroughputSample } from "./cumulativeThroughput";

/**
 * Merging a compare run's net curve onto the primary trend (Track 7).
 *
 * Both series come from `/ticks` at the **same bucket width**, so full buckets
 * land on the same absolute-grid ticks and merge into one point — the x-axis
 * alignment is free because a fork continues its parent's tick numbering. What
 * doesn't align is real, not noise: each run's trailing partial bucket is one
 * off-grid tick, and either run can extend past the other's end. Those become
 * points carrying only one side, and the chart bridges the other side's gap
 * with `connectNulls` rather than this merge inventing values.
 */
export type CompareMergeable = {
  tick: number;
  /** the compare run's cumulative net at this tick, cents */
  compareNet?: number;
};

/**
 * Zips a tick-ascending trend with a tick-ascending compare-net curve into one
 * tick-ascending series. Points sharing a tick merge; a tick only one side has
 * yields a point carrying only that side. Pure and windowless — the caller
 * hands over what it wants drawn.
 */
export function mergeCompareNet<T extends CompareMergeable>(
  trend: readonly T[],
  compareNet: readonly ThroughputSample[],
): (T | CompareMergeable)[] {
  const out: (T | CompareMergeable)[] = [];
  let i = 0;
  let j = 0;
  while (i < trend.length || j < compareNet.length) {
    const primary = i < trend.length ? trend[i] : undefined;
    const compare = j < compareNet.length ? compareNet[j] : undefined;
    if (compare === undefined || (primary !== undefined && primary.tick < compare.tick)) {
      out.push(primary!);
      i += 1;
    } else if (primary === undefined || compare.tick < primary.tick) {
      out.push({ tick: compare.tick, compareNet: compare.cents });
      j += 1;
    } else {
      out.push({ ...primary, compareNet: compare.cents });
      i += 1;
      j += 1;
    }
  }
  return out;
}
