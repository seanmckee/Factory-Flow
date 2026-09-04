import { describe, expect, it } from "vitest";
import { throughputRate, bucketThroughputRate} from "./throughputRate";
import type { ThroughputSample } from "./cumulativeThroughput";

/** n ticks numbered from `firstTick`, each earning `cents`. */
function flat(n: number, cents: number, firstTick = 1): ThroughputSample[] {
  return Array.from({ length: n }, (_, i) => ({
    tick: firstTick + i,
    cents,
  }));
}

describe("throughputRate", () => {
  it("has nothing to draw for a run that never advanced", () => {
    expect(throughputRate([])).toEqual([]);
  });

  it("scales a steady per-tick income to cents per minute", () => {
    // 10 cents every tick (second) is 600 cents a minute, from the first point
    const rate = throughputRate(flat(100, 10));
    expect(rate[0]).toEqual({ tick: 1, cents: 600 });
    expect(rate.at(-1)).toEqual({ tick: 100, cents: 600 });
  });

  it("averages a burst over the trailing window", () => {
    // one 300-cent credit at tick 5, window of 4 ticks: the burst reads as
    // 300/4 × 60 while it is inside the window and falls out after it
    const series = flat(10, 0);
    series[4] = { tick: 5, cents: 300 };
    const rate = throughputRate(series, 4);
    expect(rate[4].cents).toBe((300 / 4) * 60);
    expect(rate[7].cents).toBe((300 / 4) * 60); // tick 8, last tick covering 5
    expect(rate[8].cents).toBe(0); // tick 9, the burst has left the window
  });

  it("divides early points by the ticks actually covered, not the window", () => {
    // the data before the series isn't zero, it's absent — a full-window
    // divisor would draw a fake ramp at the left edge of a suffix window
    const rate = throughputRate(flat(3, 60), 4);
    expect(rate.map((sample) => sample.cents)).toEqual([3600, 3600, 3600]);
  });

  it("draws the same shape for a suffix as for the whole run", () => {
    const whole = flat(200, 25);
    const suffix = whole.slice(120);
    const wholeRate = throughputRate(whole);
    const suffixRate = throughputRate(suffix);
    // past the first window the suffix agrees with the whole run exactly
    expect(suffixRate.at(-1)).toEqual(wholeRate.at(-1));
    // and the left edge is flat, not a ramp up from zero
    expect(suffixRate[0].cents).toBe(25 * 60);
  });
});

describe("bucketThroughputRate", () => {
  it("rescales a minute bucket's cents to itself", () => {
    expect(
      bucketThroughputRate([{ tick: 60, cents: 500 }], 60),
    ).toEqual([{ tick: 60, cents: 500 }]);
  });

  it("rescales an hour bucket to cents per minute", () => {
    expect(
      bucketThroughputRate([{ tick: 3_600, cents: 6_000 }], 3_600),
    ).toEqual([{ tick: 3_600, cents: 100 }]);
  });

  it("maps an empty series to an empty series", () => {
    expect(bucketThroughputRate([], 60)).toEqual([]);
  });
});
