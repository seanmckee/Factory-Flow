import type { ThroughputSample } from "./cumulativeThroughput";

/**
 * The trailing window for the rate: one staffed hour. Finishes are point
 * events minutes apart, so anything shorter reads as a comb — a minute with a
 * finish spikes, the minutes between read zero — which is noise, not rate.
 */
export const RATE_WINDOW_TICKS = 3_600;

/**
 * Per-sample money as a trailing rate in **cents per staffed hour**, over a
 * series whose samples are `bucketTicks` apart (1 for the raw series, 60/3600
 * once `chartBucket` coarsens it — each sample's cents are that bucket's sum,
 * so the sliding window counts samples but divides by ticks).
 *
 * The cumulative curve answers "how much so far"; this answers "how fast
 * lately", where a stall or a burst is a shape rather than a change of slope.
 *
 * Unlike the cumulative curve, a rate needs no opening balance: every point is
 * local to its own window. The one edge the series start creates is the *left*
 * edge: ticks before the first sample aren't zero, they're absent. So a point
 * earlier than a full window into the series divides by the ticks actually
 * covered — dividing by the full window would deflate the first hour and draw
 * a fake ramp at the left edge of every chart.
 */
export function trailingRate(
  history: ThroughputSample[],
  bucketTicks: number,
  windowTicks = RATE_WINDOW_TICKS,
): ThroughputSample[] {
  const span = Math.max(1, Math.round(windowTicks / bucketTicks));
  let windowSum = 0;
  return history.map((sample, index) => {
    windowSum += sample.cents;
    if (index >= span) {
      windowSum -= history[index - span].cents;
    }
    const coveredTicks = Math.min(index + 1, span) * bucketTicks;
    return { tick: sample.tick, cents: (windowSum / coveredTicks) * 3_600 };
  });
}
