import type { ThroughputSample } from "./cumulativeThroughput";

/**
 * One simulated minute: one tick is one simulated second, so a 60-tick
 * trailing window reads as "the last minute" — long enough that a single
 * part's credit doesn't spike the curve, short enough to show a burst.
 */
export const RATE_WINDOW_TICKS = 60;

/**
 * Per-tick money as a trailing rate, in cents per simulated minute.
 *
 * The cumulative curve answers "how much so far"; this answers "how fast right
 * now", which is where a stall or a burst is visible as a shape rather than as
 * a change of slope. It is the successor to the deleted `smoothThroughput` —
 * that was a trailing mean of the same series, and Track 5 is where it was
 * superseded.
 *
 * Unlike the cumulative curve, a rate needs no opening balance: every point is
 * local to its own window, so a suffix of the run (the `/ticks` cap) is as
 * chartable as the whole thing. The one edge that cap creates is the *left*
 * edge: the ticks before the series start aren't zero, they're absent. So a
 * point earlier than `windowTicks` into the series divides by the ticks
 * actually covered rather than by `windowTicks` — dividing by the full window
 * would deflate the first minute and draw a fake ramp at the left edge of
 * every fast-forwarded chart.
 */
export function throughputRate(
  history: ThroughputSample[],
  windowTicks = RATE_WINDOW_TICKS,
): ThroughputSample[] {
  let windowSum = 0;
  return history.map((sample, index) => {
    windowSum += sample.cents;
    if (index >= windowTicks) {
      windowSum -= history[index - windowTicks].cents;
    }
    const covered = Math.min(index + 1, windowTicks);
    return { tick: sample.tick, cents: (windowSum / covered) * 60 };
  });
}

/**
 * The rate series for a **bucketed** history: each sample's cents are already
 * a whole bucket's money, so the rate is that sum rescaled to cents per
 * simulated minute — no trailing window, because a minute bucket *is* the
 * window `throughputRate` slides over the raw series, and index arithmetic on
 * a strided series would mix ticks and samples.
 */
export function bucketThroughputRate(
  history: ThroughputSample[],
  bucketTicks: number,
): ThroughputSample[] {
  return history.map((sample) => ({
    tick: sample.tick,
    cents: (sample.cents * 60) / bucketTicks,
  }));
}
