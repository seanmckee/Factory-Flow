import type { ThroughputSample } from "./cumulativeThroughput";

/** One `/ticks` row's money: what came in and what the tick cost. */
export type PnlSample = {
  tick: number;
  throughputCents: number;
  operatingExpenseCents: number;
  carryingCostCents: number;
  /** operator pay (6D); the server's netCents subtracts it, so this must too */
  wageCents: number;
  /**
   * Capital charged on this tick (6E) — a lump at the moment of purchase, not
   * an accrual, which is exactly why the curve steps down: payback is where it
   * climbs back out. The server subtracts it, so this must too, or the net
   * curve contradicts the net in the run bar.
   */
  capitalSpendCents: number;
};

export function netCentsOf(sample: PnlSample): number {
  return (
    sample.throughputCents -
    sample.operatingExpenseCents -
    sample.carryingCostCents -
    sample.wageCents -
    sample.capitalSpendCents
  );
}

/**
 * Per-tick net profit in the `{tick, cents}` shape the cumulative accumulator
 * takes, so the net curve reuses `cumulativeThroughput` rather than growing a
 * second accumulator that could disagree with it.
 */
export function netPerTick(history: PnlSample[]): ThroughputSample[] {
  return history.map((sample) => ({
    tick: sample.tick,
    cents: netCentsOf(sample),
  }));
}

/**
 * The net the run had already made — or lost — before the window starts. The
 * same suffix problem `openingCents` solves (the `/ticks` cap makes the series
 * a suffix of the run past 5000 rows), the same identity (both sides sum the
 * same frozen columns), with one deliberate difference: **no floor at zero**.
 * Net before the window can legitimately be negative — that is the entire
 * point of Track 6 — so clamping would redraw a loss as break-even. The
 * summary and the series are still two requests, so an advance landing
 * between them can skew the opening either way for one refresh; that
 * transient is accepted rather than half-corrected.
 */
export function openingNetCents(
  history: PnlSample[],
  runNetTotalCents: number,
): number {
  const inWindow = history.reduce(
    (sum, sample) => sum + netCentsOf(sample),
    0,
  );
  return runNetTotalCents - inWindow;
}
