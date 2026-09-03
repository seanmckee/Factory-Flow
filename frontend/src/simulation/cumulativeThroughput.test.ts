import { describe, expect, it } from "vitest";
import {
  cumulativeThroughput,
  openingCents,
} from "./cumulativeThroughput";
import type { ThroughputSample } from "./cumulativeThroughput";

const series: ThroughputSample[] = [
  { tick: 1, cents: 0 },
  { tick: 2, cents: 500 },
  { tick: 3, cents: 0 },
  { tick: 4, cents: 250 },
];

describe("cumulativeThroughput", () => {
  it("accumulates each tick's money onto the ones before it", () => {
    expect(cumulativeThroughput(series)).toEqual([
      { tick: 1, cents: 0 },
      { tick: 2, cents: 500 },
      { tick: 3, cents: 500 },
      { tick: 4, cents: 750 },
    ]);
  });

  it("carries on from an opening balance", () => {
    expect(cumulativeThroughput(series, 1000)).toEqual([
      { tick: 1, cents: 1000 },
      { tick: 2, cents: 1500 },
      { tick: 3, cents: 1500 },
      { tick: 4, cents: 1750 },
    ]);
  });

  it("has nothing to draw for a run that never advanced", () => {
    expect(cumulativeThroughput([])).toEqual([]);
  });
});

describe("openingCents", () => {
  it("is zero when the window covers the whole run", () => {
    expect(openingCents(series, 750)).toBe(0);
  });

  it("is the money earned before a truncated window", () => {
    // the run has earned $92.50; the 4 ticks on hand account for $7.50 of it
    expect(openingCents(series, 9250)).toBe(8500);
  });

  it("floors at zero when the total is a batch behind the series", () => {
    // an advance landing between the summary and the ticks requests: the
    // window holds money the total has not counted yet
    expect(openingCents(series, 250)).toBe(0);
  });

  it("is the whole total when the series is empty", () => {
    expect(openingCents([], 4200)).toBe(4200);
  });
});

describe("the two together", () => {
  it("end the curve on the run's own total, whatever the window", () => {
    const whole = cumulativeThroughput(series, openingCents(series, 750));
    const suffix = cumulativeThroughput(
      series.slice(2),
      openingCents(series.slice(2), 750),
    );
    expect(whole.at(-1)?.cents).toBe(750);
    expect(suffix.at(-1)?.cents).toBe(750);
  });
});
