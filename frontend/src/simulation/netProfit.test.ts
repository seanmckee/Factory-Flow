import { describe, expect, it } from "vitest";
import { cumulativeThroughput } from "./cumulativeThroughput";
import { netCentsOf, netPerTick, openingNetCents } from "./netProfit";
import type { PnlSample } from "./netProfit";

const sample = (
  tick: number,
  throughputCents: number,
  operatingExpenseCents: number,
  carryingCostCents: number,
  wageCents = 0,
): PnlSample => ({
  tick,
  throughputCents,
  operatingExpenseCents,
  carryingCostCents,
  wageCents,
});

describe("netCentsOf", () => {
  it("subtracts wages beside the other two costs", () => {
    // the server's netCents subtracts four terms; a three-term client curve
    // would drift above the run bar the moment anyone is paid
    expect(netCentsOf(sample(1, 500, 5, 1, 100))).toBe(394);
  });
});

const series: PnlSample[] = [
  sample(1, 0, 5, 2), // -7: a tick that only burned money
  sample(2, 500, 5, 1), // +494
  sample(3, 0, 6, 1), // -7
  sample(4, 250, 5, 0), // +245
];

describe("netPerTick", () => {
  it("nets each tick's throughput against its expense", () => {
    expect(netPerTick(series)).toEqual([
      { tick: 1, cents: -7 },
      { tick: 2, cents: 494 },
      { tick: 3, cents: -7 },
      { tick: 4, cents: 245 },
    ]);
  });

  it("maps an empty series to an empty series", () => {
    expect(netPerTick([])).toEqual([]);
  });
});

describe("openingNetCents", () => {
  it("is zero when the window covers the whole run", () => {
    // window net = 725, and the run has made exactly that
    expect(openingNetCents(series, 725)).toBe(0);
  });

  it("is what the run netted before the window", () => {
    expect(openingNetCents(series, 1725)).toBe(1000);
  });

  it("is negative when the run lost money before the window — no floor", () => {
    // the run as a whole is down $2.75 while the window is up $7.25
    expect(openingNetCents(series, -275)).toBe(-1000);
  });

  it("returns the whole total for an empty series", () => {
    expect(openingNetCents([], -592)).toBe(-592);
  });
});

describe("the two together", () => {
  it("ends the curve at the run's net total", () => {
    const runNetTotalCents = 1725;
    const curve = cumulativeThroughput(
      netPerTick(series),
      openingNetCents(series, runNetTotalCents),
    );
    expect(curve.at(-1)?.cents).toBe(runNetTotalCents);
  });

  it("crosses zero when a profitable window digs the run out of a loss", () => {
    const curve = cumulativeThroughput(
      netPerTick(series),
      openingNetCents(series, 525), // opened at -200
    );
    expect(curve.map((point) => point.cents)).toEqual([-207, 287, 280, 525]);
  });
});
