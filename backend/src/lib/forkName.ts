/**
 * The name a fork gets when the caller doesn't supply one: the parent's name
 * plus the calendar day the fork was taken on. Pure and separate from
 * `runService` so it is testable without importing the db module.
 *
 * The suffix survives truncation, not the parent's name — a fork of a
 * 255-char run must still say it is a fork and of which day.
 */
export const RUN_NAME_MAX = 255;

export function defaultForkName(
  parentName: string,
  tickNum: number,
  dayTicks: number,
): string {
  // same convention as the frontend's formatTickTime: tick 0 is Day 1
  const day = Math.floor(tickNum / dayTicks) + 1;
  const suffix = ` · fork @ D${day}`;
  return parentName.slice(0, RUN_NAME_MAX - suffix.length) + suffix;
}
