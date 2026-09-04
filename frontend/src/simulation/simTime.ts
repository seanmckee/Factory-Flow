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

/**
 * A tick as calendar time — "Day 2 · 3:41:05". Days are 1-based and roll at
 * `ticksPerDay`, so tick 0 is Day 1 · 0:00:00: the clock reads staffed time,
 * which is the only time the run simulates.
 */
export function formatTickTime(
  tick: number,
  ticksPerDay: number = TICKS_PER_DAY,
): string {
  const day = Math.floor(tick / ticksPerDay) + 1;
  const rest = tick % ticksPerDay;
  const hours = Math.floor(rest / 3600);
  const minutes = Math.floor((rest % 3600) / 60);
  const seconds = rest % 60;
  const pad = (figure: number) => String(figure).padStart(2, "0");
  return `Day ${day} · ${hours}:${pad(minutes)}:${pad(seconds)}`;
}
