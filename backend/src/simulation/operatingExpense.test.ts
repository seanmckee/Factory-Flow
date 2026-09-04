import { describe, expect, it } from "vitest";
import {
  accrueCarrying,
  accrueRate,
  materialCostByWorkOrder,
  rateWindowCents,
  timeExpenseAtTick,
  wagesAtTick,
  wipMaterialValueCents,
  type CostRates,
} from "./operatingExpense.js";
import type { WipPart } from "./types.js";

/** day length is data, so tests use a tiny day and readable numbers */
const DAY = 10;

const rates = (overrides: Partial<CostRates> = {}): CostRates => ({
  dayTicks: DAY,
  facilityOverheadCentsPerDay: 0,
  wipCarryingBpsPerDay: 0,
  standingCostByWorkCenter: new Map(),
  wageCentsPerHourByWorkCenter: new Map(),
  ...overrides,
});

const wip = (workOrderId: number, unitIndex = 0): WipPart => ({
  id: `part-${workOrderId}-${unitIndex}`,
  workOrderId,
  unitIndex,
  releasedAtTick: 0,
  stepIndex: 0,
  progressSeconds: 0,
  actualProcessTimeSeconds: 5,
});

describe("accrueRate", () => {
  it("sums to exactly the rate over one full day", () => {
    let total = 0;
    for (let t = 1; t <= DAY; t++) total += accrueRate(17, t, DAY);
    expect(total).toBe(17);
  });

  it("sums to exactly N times the rate over N days", () => {
    let total = 0;
    for (let t = 1; t <= 3 * DAY; t++) total += accrueRate(17, t, DAY);
    expect(total).toBe(51);
  });

  it("never charges more than a tick's ideal share rounded up", () => {
    // rate 17 over 10 ticks is 1.7/tick: every tick charges 1 or 2
    for (let t = 1; t <= DAY; t++) {
      const cents = accrueRate(17, t, DAY);
      expect(cents === 1 || cents === 2).toBe(true);
    }
  });

  it("charges zero for a zero rate", () => {
    expect(accrueRate(0, 5, DAY)).toBe(0);
  });

  it("throws on a negative rate and a zero-length day", () => {
    expect(() => accrueRate(-1, 1, DAY)).toThrow(/negative rate/);
    expect(() => accrueRate(10, 1, 0)).toThrow(/not a day/);
  });
});

describe("rateWindowCents", () => {
  it("equals the loop-sum of per-tick accruals over the window", () => {
    let loop = 0;
    for (let t = 4; t <= 27; t++) loop += accrueRate(17, t, DAY);
    expect(rateWindowCents(17, 4, 27, DAY)).toBe(loop);
  });

  it("covers a whole day exactly", () => {
    expect(rateWindowCents(17, 11, 20, DAY)).toBe(17);
  });

  it("throws on a backwards window", () => {
    expect(() => rateWindowCents(17, 5, 4, DAY)).toThrow(/backwards/);
  });
});

describe("wagesAtTick", () => {
  it("sums each centre's hourly bill to the cent over a staffed hour", () => {
    const r = rates({
      wageCentsPerHourByWorkCenter: new Map([
        [10, 1800],
        [20, 833],
      ]),
    });
    let total = 0;
    for (let tick = 1; tick <= 3600; tick++) total += wagesAtTick(r, tick);
    expect(total).toBe(2633);
  });

  it("accrues per centre and then sums, never on the summed rate", () => {
    // two 1c/hour centres each pay their cent at tick 3600; a combined 2c
    // rate would pay one at 1800, so mid-hour the two schedules disagree
    const r = rates({
      wageCentsPerHourByWorkCenter: new Map([
        [10, 1],
        [20, 1],
      ]),
    });
    let firstHalf = 0;
    for (let tick = 1; tick <= 1800; tick++) firstHalf += wagesAtTick(r, tick);
    expect(firstHalf).toBe(0);
    expect(wagesAtTick(r, 3600)).toBe(2);
  });

  it("ignores the day length: a longer day is simply more paid hours", () => {
    // 3600c/hour is one cent every tick whatever dayTicks says — wages scale
    // with staffed time while the per-day rates amortize thinner, which is
    // the whole economics of a second shift
    const r = rates({
      dayTicks: 20,
      wageCentsPerHourByWorkCenter: new Map([[10, 3600]]),
    });
    expect(wagesAtTick(r, 1)).toBe(1);
    expect(wagesAtTick(r, 15)).toBe(1);
  });
});

describe("timeExpenseAtTick", () => {
  it("accrues per rate, not on the summed rate", () => {
    // two rates of 5 over a 10-tick day each accrue 0 at tick 1 (0.5 floors
    // to 0), where a single combined rate of 10 would charge 1 — the split
    // is what makes the total equal any breakdown by construction
    const split = rates({
      standingCostByWorkCenter: new Map([
        [10, 5],
        [20, 5],
      ]),
    });
    const combined = rates({ facilityOverheadCentsPerDay: 10 });
    expect(timeExpenseAtTick(split, 1)).toBe(0);
    expect(timeExpenseAtTick(combined, 1)).toBe(1);
  });

  it("sums overhead and every centre over a full day", () => {
    const config = rates({
      facilityOverheadCentsPerDay: 100,
      standingCostByWorkCenter: new Map([
        [10, 30],
        [20, 7],
      ]),
    });
    let total = 0;
    for (let t = 1; t <= DAY; t++) total += timeExpenseAtTick(config, t);
    expect(total).toBe(137);
  });

  it("charges a free factory nothing", () => {
    expect(timeExpenseAtTick(rates(), 1)).toBe(0);
  });
});

describe("materialCostByWorkOrder", () => {
  it("maps each work order to its part's material cost", () => {
    const map = materialCostByWorkOrder(
      [
        { id: 1, partId: 100 },
        { id: 2, partId: 200 },
      ],
      [
        { id: 100, materialCostCents: 1200 },
        { id: 200, materialCostCents: 800 },
      ],
    );
    expect(map.get(1)).toBe(1200);
    expect(map.get(2)).toBe(800);
  });

  it("throws when a work order's part was not loaded", () => {
    expect(() =>
      materialCostByWorkOrder([{ id: 1, partId: 100 }], []),
    ).toThrow("Work order 1 makes part 100, which was not loaded");
  });
});

describe("wipMaterialValueCents", () => {
  it("sums the floor's material value", () => {
    const cost = new Map([
      [1, 1200],
      [2, 800],
    ]);
    expect(
      wipMaterialValueCents([wip(1, 0), wip(1, 1), wip(2, 0)], cost),
    ).toBe(3200);
  });

  it("values an empty floor at zero", () => {
    expect(wipMaterialValueCents([], new Map())).toBe(0);
  });

  it("throws when a part's work order was not loaded", () => {
    expect(() => wipMaterialValueCents([wip(7)], new Map())).toThrow(
      "Part part-7-0 belongs to work order 7, which was not loaded",
    );
  });
});

describe("accrueCarrying", () => {
  // K = 10000 * DAY = 100000 numerator units per cent

  it("totals exactly floor(N·V·c / K) over N constant ticks", () => {
    // V=1200 cents at c=250 bps over a 10-tick day: 1200*0.025 = 30 cents/day
    let remainder = 0;
    let total = 0;
    for (let t = 1; t <= DAY; t++) {
      const accrual = accrueCarrying(1200, 250, DAY, remainder);
      total += accrual.carryingCostCents;
      remainder = accrual.carryRemainder;
    }
    expect(total).toBe(30);
    expect(remainder).toBe(0);
  });

  it("keeps the remainder in [0, K) and never loses sub-cent value", () => {
    let remainder = 0;
    let total = 0;
    for (let t = 1; t <= 7; t++) {
      const accrual = accrueCarrying(333, 100, DAY, remainder);
      expect(accrual.carryRemainder).toBeGreaterThanOrEqual(0);
      expect(accrual.carryRemainder).toBeLessThan(100_000);
      total += accrual.carryingCostCents;
      remainder = accrual.carryRemainder;
    }
    // 7 * 333 * 100 = 233100 units = 2 cents + 33100 carried
    expect(total).toBe(2);
    expect(remainder).toBe(33_100);
  });

  it("is the same fold whether run in one stretch or resumed mid-way", () => {
    const values = [1200, 1200, 900, 900, 400, 400, 0, 0, 2500, 2500];

    const run = (window: number[], startRemainder: number) => {
      const charges: number[] = [];
      let remainder = startRemainder;
      for (const value of window) {
        const accrual = accrueCarrying(value, 777, DAY, remainder);
        charges.push(accrual.carryingCostCents);
        remainder = accrual.carryRemainder;
      }
      return { charges, remainder };
    };

    const whole = run(values, 0);
    const first = run(values.slice(0, 4), 0);
    const second = run(values.slice(4), first.remainder);
    expect([...first.charges, ...second.charges]).toEqual(whole.charges);
    expect(second.remainder).toBe(whole.remainder);
  });

  it("charges nothing and keeps the remainder for an empty floor", () => {
    expect(accrueCarrying(0, 500, DAY, 42)).toEqual({
      carryingCostCents: 0,
      carryRemainder: 42,
    });
  });

  it("charges nothing at a zero rate", () => {
    expect(accrueCarrying(5000, 0, DAY, 42)).toEqual({
      carryingCostCents: 0,
      carryRemainder: 42,
    });
  });

  it("throws on negative inputs and an out-of-range remainder", () => {
    expect(() => accrueCarrying(-1, 500, DAY, 0)).toThrow(/worth/);
    expect(() => accrueCarrying(100, -1, DAY, 0)).toThrow(/negative carrying/);
    expect(() => accrueCarrying(100, 500, DAY, 100_000)).toThrow(/outside/);
  });
});
