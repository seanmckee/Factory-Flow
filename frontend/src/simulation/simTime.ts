/**
 * Simulated time. One tick is one simulated second, and a calendar day is
 * `shifts × 28,800` ticks (8-hour shifts) — one shift today, so this constant
 * is the fallback; prefer the run's own frozen `dayTicks`, which is what its
 * rates actually accrued against.
 */
export const TICKS_PER_DAY = 28_800;

export function ticksToDays(
  ticks: number,
  ticksPerDay: number = TICKS_PER_DAY,
): number {
  return ticks / ticksPerDay;
}

/** "0.6 days", "3 days" — for stat-card detail lines, not axes. */
export function formatDays(days: number): string {
  const rounded = Math.round(days * 10) / 10;
  return `${rounded} day${rounded === 1 ? "" : "s"}`;
}
