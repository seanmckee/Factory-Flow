import { describe, expect, it } from "vitest";
import { trailingRate } from "./throughputRate";
import type { ThroughputSample } from "./cumulativeThroughput";

/** `count` samples, `bucketTicks` apart, each carrying `cents`. */
const flat = (
  count: number,
  bucketTicks: number,
  cents: number,
): ThroughputSample[] =>
  Array.from({ length: count }, (_, i) => ({
    tick: (i + 1) * bucketTicks,
    cents,
  }));

describe("trailingRate", () => {
  it("reads a steady flow as its true hourly rate", () => {
    // 100c per 60-tick bucket = 6000c per staffed hour
    const rate = trailingRate(flat(120, 60, 100), 60);
    expect(rate.at(-1)?.cents).toBe(6_000);
  });

  it("agrees between raw and bucketed series on the same steady flow", () => {
    // 1c per tick and 60c per minute are the same money
    const raw = trailingRate(flat(7_200, 1, 1), 1);
    const bucketed = trailingRate(flat(120, 60, 60), 60);
    expect(raw.at(-1)?.cents).toBe(3_600);
    expect(bucketed.at(-1)?.cents).toBe(3_600);
  });

  it("divides the left edge by the ticks actually covered, not the window", () => {
    // the first sample alone: 120c over 60 ticks = 7200c/hour, not a ramp
    const rate = trailingRate(flat(3, 60, 120), 60);
    expect(rate[0]?.cents).toBe(7_200);
    expect(rate[1]?.cents).toBe(7_200);
  });

  it("slides the window: old money falls out", () => {
    // one early spike, then silence for a full window
    const series = [
      { tick: 60, cents: 6_000 },
      ...flat(90, 60, 0).map((s) => ({ ...s, tick: s.tick + 60 })),
    ];
    const rate = trailingRate(series, 60);
    expect(rate[0]?.cents).toBe(360_000);
    expect(rate.at(-1)?.cents).toBe(0);
  });

  it("smooths point events into a level, which is the reason it exists", () => {
    // a finish every 10th minute: spiky per bucket, steady per hour
    const series = flat(120, 60, 0).map((s, i) =>
      i % 10 === 9 ? { ...s, cents: 1_000 } : s,
    );
    const rate = trailingRate(series, 60);
    expect(rate.at(-1)?.cents).toBe(6_000);
    expect(rate.at(-11)?.cents).toBe(6_000);
  });

  it("maps an empty series to an empty series", () => {
    expect(trailingRate([], 60)).toEqual([]);
  });
});
