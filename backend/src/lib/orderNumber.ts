export type OrderPrefix = "WO" | "SO";

/**
 * Next order number for a prefix, e.g. "WO-1004".
 *
 * order_number is a varchar, so the suffix has to be compared numerically - a
 * string max would rank "WO-999" above "WO-1001". Unrecognised values (a
 * different prefix, or a hand-entered number) are ignored rather than throwing.
 *
 * An empty table yields "WO-0001" / "SO-0001".
 *
 * Not race-free: two concurrent creates read the same max and the second hits
 * the unique constraint on order_number. Fine for a single-user simulator.
 */
export function nextOrderNumber(
  existing: string[],
  prefix: OrderPrefix,
): string {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);

  let highest = 0;
  for (const value of existing) {
    const match = pattern.exec(value);
    if (!match) continue;

    // noUncheckedIndexedAccess: a capture group is string | undefined
    const digits = match[1];
    if (digits === undefined) continue;

    const parsed = Number(digits);
    if (Number.isInteger(parsed) && parsed > highest) highest = parsed;
  }

  return `${prefix}-${String(highest + 1).padStart(4, "0")}`;
}
