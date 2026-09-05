import { describe, expect, it } from "vitest";
import { mergeCompareNet } from "./compareTrend";

const point = (tick: number, net: number) => ({ tick, net });

describe("mergeCompareNet", () => {
  it("merges points sharing a grid tick into one", () => {
    const merged = mergeCompareNet(
      [point(60, 10), point(120, 20)],
      [
        { tick: 60, cents: 5 },
        { tick: 120, cents: 15 },
      ],
    );
    expect(merged).toEqual([
      { tick: 60, net: 10, compareNet: 5 },
      { tick: 120, net: 20, compareNet: 15 },
    ]);
  });

  it("keeps a tick only one side has, carrying only that side", () => {
    // the compare run advanced further: its curve extends past the primary's
    const merged = mergeCompareNet(
      [point(60, 10)],
      [
        { tick: 60, cents: 5 },
        { tick: 120, cents: 15 },
        { tick: 130, cents: 16 }, // its trailing partial bucket, off-grid
      ],
    );
    expect(merged).toEqual([
      { tick: 60, net: 10, compareNet: 5 },
      { tick: 120, compareNet: 15 },
      { tick: 130, compareNet: 16 },
    ]);
  });

  it("interleaves off-grid trailing points in tick order", () => {
    // each run's final partial bucket lands off the shared grid
    const merged = mergeCompareNet(
      [point(60, 10), point(95, 12)],
      [
        { tick: 60, cents: 5 },
        { tick: 90, cents: 6 },
      ],
    );
    expect(merged.map((p) => p.tick)).toEqual([60, 90, 95]);
    expect(merged[1]).toEqual({ tick: 90, compareNet: 6 });
    expect(merged[2]).toEqual({ tick: 95, net: 12 });
  });

  it("returns the trend untouched for an empty compare series", () => {
    const trend = [point(60, 10), point(120, 20)];
    expect(mergeCompareNet(trend, [])).toEqual(trend);
  });

  it("returns only compare points for an empty trend", () => {
    expect(mergeCompareNet([], [{ tick: 60, cents: 5 }])).toEqual([
      { tick: 60, compareNet: 5 },
    ]);
  });
});
