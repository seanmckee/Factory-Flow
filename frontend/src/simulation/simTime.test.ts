import { describe, expect, it } from "vitest";
import { formatDays, ticksToDays, TICKS_PER_DAY } from "./simTime";

describe("ticksToDays", () => {
  it("converts a whole day exactly", () => {
    expect(ticksToDays(TICKS_PER_DAY)).toBe(1);
    expect(ticksToDays(2000, 1000)).toBe(2);
  });

  it("keeps fractions of a day", () => {
    expect(ticksToDays(500, 1000)).toBe(0.5);
  });

  it("converts zero ticks to zero days", () => {
    expect(ticksToDays(0)).toBe(0);
  });
});

describe("formatDays", () => {
  it("rounds to one decimal", () => {
    expect(formatDays(0.649)).toBe("0.6 days");
    expect(formatDays(2.96)).toBe("3 days");
  });

  it("uses the singular only for exactly one day after rounding", () => {
    expect(formatDays(1.04)).toBe("1 day");
    expect(formatDays(1.06)).toBe("1.1 days");
  });
});
