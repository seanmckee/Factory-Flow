export type ThroughputSample = { tick: number; cents: number };

/**
 * The money a run had already earned before the window starts.
 *
 * `GET /:id/ticks` keeps only the newest `MAX_TICK_SERIES_ROWS` (5000) rows in
 * the window, so past tick 5000 the series the chart holds is a *suffix* of
 * the run. Accumulating it from zero would re-base the curve and put it in
 * plain contradiction with the run's total money on the line above it — and a
 * single fast-forward reaches that in one press.
 *
 * The identity that makes this exact: a tick's `throughputCents` is the sum of
 * its finished parts' credits, and the run's total is the sum of the same
 * frozen per-part columns, so everything the run earned before the window is
 * the total minus the window's own sum. No API change, and nothing to keep in
 * sync.
 */
export function openingCents(
  history: ThroughputSample[],
  runTotalCents: number,
): number {
  const inWindow = history.reduce((sum, sample) => sum + sample.cents, 0);
  // The summary and the series are two requests: an advance landing between
  // them leaves the window holding money the total hasn't counted yet. A
  // negative opening balance would draw the curve below zero for a frame, and
  // the next refresh corrects it, so floor it here.
  return Math.max(0, runTotalCents - inWindow);
}

/** Per-tick money accumulated into a curve, carrying on from `opening`. */
export function cumulativeThroughput(
  history: ThroughputSample[],
  opening = 0,
): ThroughputSample[] {
  let running = opening;
  return history.map((sample) => {
    running += sample.cents;
    return { tick: sample.tick, cents: running };
  });
}
