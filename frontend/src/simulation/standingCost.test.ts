import { describe, expect, it } from "vitest";
import { windowStandingCostCents } from "./standingCost";

describe("windowStandingCostCents", () => {
  it("charges exactly the rate over a whole day", () => {
    expect(windowStandingCostCents(30_000, 1000, 1000)).toBe(30_000);
  });

  it("rounds a part-day proportionally", () => {
    expect(windowStandingCostCents(30_000, 500, 1000)).toBe(15_000);
    expect(windowStandingCostCents(101, 1, 3)).toBe(34);
  });

  it("charges nothing for zero observed ticks", () => {
    expect(windowStandingCostCents(30_000, 0, 1000)).toBe(0);
  });

  it("sums across centres to a hand total", () => {
    const rates = [5_000, 15_000, 30_000];
    const total = rates.reduce(
      (sum, rate) => sum + windowStandingCostCents(rate, 250, 1000),
      0,
    );
    expect(total).toBe(1_250 + 3_750 + 7_500);
  });
});
