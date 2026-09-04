/**
 * What a work centre's frozen standing rate cost over a window — display-only
 * proportional rounding for the dashboard's per-centre column. The ledger of
 * record is the summed `operatingExpenseCents` on the tick rows: the server
 * deliberately doesn't serve a per-centre figure, because rate × window stops
 * being true the moment a run's rates can change mid-run (6E).
 *
 * `observedTicks` comes from the window's own aggregate, so a centre created
 * mid-run isn't billed for time it did not exist.
 */
export function windowStandingCostCents(
  rateCentsPerDay: number,
  observedTicks: number,
  ticksPerDay: number,
): number {
  return Math.round((rateCentsPerDay * observedTicks) / ticksPerDay);
}
