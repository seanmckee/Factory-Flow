import { describe, it, expect } from "vitest";
import type { CostRates, DatedRate } from "./operatingExpense.js";
import { unitDraw } from "./sampleProcessTime.js";
import { simulateBatch, type RunState } from "./simulateBatch.js";
import type { Routing, WipPart, WorkCenter } from "./types.js";

const SEED = 42;

/** one operation at center 10, so a part finishes every 5 ticks or so */
const oneStep: Routing = {
  steps: [{ workCenterId: 10, processTimeSeconds: 5, setupTimeSeconds: 0, scrapBps: 0 }],
};

const workCenters = new Map<number, WorkCenter>([
  [10, { id: 10, capacity: 1 }],
  [20, { id: 20, capacity: 1 }],
]);

const part = (id: string, overrides: Partial<WipPart> = {}): WipPart => ({
  id,
  workOrderId: 10,
  unitIndex: 0,
  releasedAtTick: 0,
  stepIndex: 0,
  progressSeconds: 0,
  actualProcessTimeSeconds: 5,
  ...overrides,
});

/** a rate as it reads for a centre no capital action has touched */
const dated = (cents: number, sinceTick = 0): DatedRate => ({
  cents,
  sinceTick,
});

/** a free factory: every rate zero, so pre-expense tests are unchanged */
const freeCosts: CostRates = {
  dayTicks: 10,
  facilityOverheadCentsPerDay: 0,
  wipCarryingBpsPerDay: 0,
  standingCostByWorkCenter: new Map(),
  wageCentsPerHourByWorkCenter: new Map(),
};

const state = (overrides: Partial<RunState> = {}): RunState => ({
  tickNum: 0,
  rngSeed: SEED,
  wipParts: [],
  routingByWorkOrder: new Map([[10, oneStep]]),
  workCenters,
  workOrders: [{ id: 10, partId: 1 }],
  parts: [{ id: 1, materialCostCents: 1200 }],
  // SO-20 promises the end of the fixture's 10-tick day; SO-21 promises nothing
  salesOrders: [
    { id: 20, unitPriceCents: 5000, dueAtTick: 10 },
    { id: 21, unitPriceCents: 5500, dueAtTick: null },
  ],
  // SO-20 takes the first unit of the work order, SO-21 the next
  allocations: [
    { id: 1, salesOrderId: 20, workOrderId: 10, quantity: 1 },
    { id: 2, salesOrderId: 21, workOrderId: 10, quantity: 1 },
  ],
  priorCounts: new Map(),
  costs: freeCosts,
  carryRemainder: 0,
  setupDone: new Set<string>(),
  ...overrides,
});

describe("simulateBatch", () => {
  it("advances the run's tick number by the batch length", () => {
    const batch = simulateBatch(state({ tickNum: 300 }), 500);
    expect(batch.tickNum).toBe(800);
  });

  it("emits one tick record per tick, numbered from where the run left off", () => {
    const batch = simulateBatch(state({ tickNum: 300 }), 3);
    expect(batch.ticks.map((tick) => tick.tickNum)).toEqual([301, 302, 303]);
  });

  it("records a tick for every tick, including ones where nothing happened", () => {
    // an empty floor still passes time, and Track 6 charges rent for it
    const batch = simulateBatch(state(), 3);
    expect(batch.ticks).toHaveLength(3);
    expect(batch.ticks.map((tick) => tick.throughputCents)).toEqual([0, 0, 0]);
    expect(batch.ticks.map((tick) => tick.wipCount)).toEqual([0, 0, 0]);
  });

  it("reports every work center every tick, idle ones included", () => {
    const batch = simulateBatch(state({ wipParts: [part("p1")] }), 1);
    expect(batch.ticks[0]?.workCenters).toEqual([
      { workCenterId: 10, busy: 1, queued: 0 },
      { workCenterId: 20, busy: 0, queued: 0 },
    ]);
  });

  it("advances a part without finishing it, and carries it out as WIP", () => {
    const batch = simulateBatch(state({ wipParts: [part("p1")] }), 3);
    expect(batch.finishedParts).toEqual([]);
    expect(batch.wipParts).toHaveLength(1);
    expect(batch.wipParts[0]?.progressSeconds).toBe(3);
  });

  it("does not mutate the state it is given", () => {
    const original = part("p1");
    const priorCounts = new Map([[10, 1]]);
    const input = state({ wipParts: [original], priorCounts });

    simulateBatch(input, 10);

    expect(original.progressSeconds).toBe(0);
    expect(input.wipParts).toHaveLength(1);
    expect(priorCounts.get(10)).toBe(1);
  });

  it("finishes a part with the tick it completed on and the tick it was released", () => {
    const batch = simulateBatch(
      state({ tickNum: 100, wipParts: [part("p1", { releasedAtTick: 97 })] }),
      10,
    );

    expect(batch.finishedParts).toHaveLength(1);
    expect(batch.finishedParts[0]).toMatchObject({
      partId: "p1",
      workOrderId: 10,
      releasedAtTick: 97,
      completedAtTick: 105,
    });
    expect(batch.wipParts).toEqual([]);
  });

  it("freezes the money that priced each finished unit", () => {
    const batch = simulateBatch(state({ wipParts: [part("p1")] }), 10);
    expect(batch.finishedParts[0]).toMatchObject({
      throughputCents: 3800, // 5000 - 1200
      salesOrderId: 20,
      unitPriceCents: 5000,
      materialCostCents: 1200,
      dueAtTick: 10,
    });
  });

  it("freezes the covering order's due tick, null when it made no promise", () => {
    const batch = simulateBatch(
      state({ wipParts: [part("p1"), part("p2")] }),
      30,
    );
    // p2 is covered by SO-21, which has a price but no due date — the record
    // keeps the price and stays unmeasured
    expect(batch.finishedParts.map((p) => p.dueAtTick)).toEqual([10, null]);
  });

  it("freezes the due tick a unit finished under, not a later edit", () => {
    // batch 1 under a day-1 promise; the order book is then edited; batch 2
    // reads the new promise. Frozen rows must keep what they finished under —
    // this is the whole of the due-day edit caveat, exercised where it lives.
    const first = simulateBatch(state({ wipParts: [part("p1")] }), 10);
    expect(first.finishedParts[0]?.dueAtTick).toBe(10);

    const second = simulateBatch(
      state({
        tickNum: first.tickNum,
        wipParts: [part("p2")],
        priorCounts: first.priorCounts,
        salesOrders: [
          { id: 20, unitPriceCents: 5000, dueAtTick: 20 },
          { id: 21, unitPriceCents: 5500, dueAtTick: 20 },
        ],
      }),
      10,
    );

    expect(first.finishedParts[0]?.dueAtTick).toBe(10);
    expect(second.finishedParts[0]?.dueAtTick).toBe(20);
  });

  it("prices later units against later allocations within one batch", () => {
    // the crux of advancing in memory: the second unit must know the first one
    // already consumed SO-20, even though neither has been written yet
    const batch = simulateBatch(
      state({ wipParts: [part("p1"), part("p2")] }),
      30,
    );

    expect(batch.finishedParts).toHaveLength(2);
    expect(batch.finishedParts.map((p) => p.salesOrderId)).toEqual([20, 21]);
    expect(batch.finishedParts.map((p) => p.unitPriceCents)).toEqual([
      5000, 5500,
    ]);
  });

  it("continues pricing from the units that finished before the batch", () => {
    const batch = simulateBatch(
      state({ wipParts: [part("p1")], priorCounts: new Map([[10, 1]]) }),
      10,
    );
    expect(batch.finishedParts[0]?.salesOrderId).toBe(21);
  });

  it("carries the advanced counts out, so the next batch prices correctly", () => {
    const batch = simulateBatch(
      state({ wipParts: [part("p1")], priorCounts: new Map([[10, 4]]) }),
      10,
    );
    expect(batch.priorCounts.get(10)).toBe(5);
  });

  it("earns nothing for a unit built beyond what was sold, but keeps its cost", () => {
    const batch = simulateBatch(
      state({ wipParts: [part("p1")], priorCounts: new Map([[10, 2]]) }),
      10,
    );
    expect(batch.finishedParts[0]).toMatchObject({
      throughputCents: 0,
      salesOrderId: null,
      unitPriceCents: null,
      materialCostCents: 1200,
      dueAtTick: null,
    });
  });

  it("credits a tick with the sum of the parts that finished in it", () => {
    const batch = simulateBatch(
      state({ wipParts: [part("p1"), part("p2")] }),
      30,
    );

    const earned = batch.ticks.reduce((sum, t) => sum + t.throughputCents, 0);
    const perPart = batch.finishedParts.reduce(
      (sum, p) => sum + p.throughputCents,
      0,
    );
    expect(earned).toBe(perPart);
    expect(earned).toBe(3800 + 4300);
  });

  it("is the same run whether advanced in one batch or several", () => {
    // what makes chunking a long advance safe, and what a fork replays
    const once = simulateBatch(state({ wipParts: [part("p1"), part("p2")] }), 30);

    let carried = state({ wipParts: [part("p1"), part("p2")] });
    const chunks = [];
    for (let i = 0; i < 3; i++) {
      const batch = simulateBatch(carried, 10);
      chunks.push(batch);
      carried = state({
        tickNum: batch.tickNum,
        wipParts: batch.wipParts,
        priorCounts: batch.priorCounts,
      });
    }

    expect(chunks.at(-1)?.tickNum).toBe(once.tickNum);
    expect(chunks.flatMap((b) => b.finishedParts)).toEqual(once.finishedParts);
    expect(chunks.flatMap((b) => b.ticks)).toEqual(once.ticks);
  });

  it("pays a changeover once, however the run is chunked", () => {
    // the reason the paid state is persisted rather than derived: a batch
    // boundary must not re-charge a setup an earlier batch already paid
    const withSetup = (): Partial<RunState> => ({
      wipParts: [part("p1"), part("p2", { unitIndex: 1 })],
      routingByWorkOrder: new Map([
        [10, { steps: [{ workCenterId: 10, processTimeSeconds: 5, setupTimeSeconds: 4, scrapBps: 0 }] }],
      ]),
    });
    const once = simulateBatch(state(withSetup()), 30);

    let carried = state(withSetup());
    const chunks = [];
    for (let i = 0; i < 3; i++) {
      const batch = simulateBatch(carried, 10);
      chunks.push(batch);
      carried = state({
        ...withSetup(),
        tickNum: batch.tickNum,
        wipParts: batch.wipParts,
        priorCounts: batch.priorCounts,
        setupDone: batch.setupDone,
      });
    }

    expect(chunks.flatMap((b) => b.setupsStarted)).toEqual(once.setupsStarted);
    expect(once.setupsStarted).toHaveLength(1);
    expect(chunks.flatMap((b) => b.finishedParts)).toEqual(once.finishedParts);
    expect(chunks.flatMap((b) => b.ticks)).toEqual(once.ticks);
  });

  it("stamps a changeover with the tick it began and carries the set out", () => {
    const batch = simulateBatch(
      state({
        tickNum: 100,
        wipParts: [part("p1")],
        routingByWorkOrder: new Map([
          [10, { steps: [{ workCenterId: 10, processTimeSeconds: 5, setupTimeSeconds: 4, scrapBps: 0 }] }],
        ]),
      }),
      1,
    );

    expect(batch.setupsStarted).toEqual([
      { workOrderId: 10, stepIndex: 0, atTick: 101 },
    ]);
    expect(batch.setupDone.has("10:0")).toBe(true);
    // the input state's set is copied, not mutated
    expect(state().setupDone.has("10:0")).toBe(false);
  });

  it("charges nothing for a changeover loaded as already paid", () => {
    const alreadySetUp = state({
      wipParts: [part("p1")],
      routingByWorkOrder: new Map([
        [10, { steps: [{ workCenterId: 10, processTimeSeconds: 5, setupTimeSeconds: 4, scrapBps: 0 }] }],
      ]),
      setupDone: new Set(["10:0"]),
    });
    const batch = simulateBatch(alreadySetUp, 6);

    // 5 seconds of process and no setup: the part is done, and nothing started
    expect(batch.finishedParts).toHaveLength(1);
    expect(batch.finishedParts[0]?.completedAtTick).toBe(5);
    expect(batch.setupsStarted).toEqual([]);
  });

  it("a scrapped unit consumes no allocation: the next good unit takes its sale", () => {
    // seed 7 makes unit 0's scrap draw the low one; the rate sits between the
    // two draws, so unit 0 dies and unit 1 survives — and must be credited to
    // SO-20, the allocation the dead unit would have consumed
    const seed = 7;
    const d0 = unitDraw({ seed, workOrderId: 10, unitIndex: 0, stepIndex: 0 }, "scrap");
    const d1 = unitDraw({ seed, workOrderId: 10, unitIndex: 1, stepIndex: 0 }, "scrap");
    const bps = Math.floor(d0 * 10000) + 1;
    expect(d0).toBeLessThan(d1);
    expect(d1).toBeGreaterThanOrEqual(bps / 10000);

    const batch = simulateBatch(
      state({
        rngSeed: seed,
        wipParts: [part("p1"), part("p2", { unitIndex: 1 })],
        routingByWorkOrder: new Map([
          [10, { steps: [{ workCenterId: 10, processTimeSeconds: 5, setupTimeSeconds: 0, scrapBps: bps }] }],
        ]),
      }),
      30,
    );

    expect(batch.scrappedParts).toHaveLength(1);
    expect(batch.scrappedParts[0]).toMatchObject({
      partId: "p1",
      workOrderId: 10,
      unitIndex: 0,
      stepIndex: 0,
      workCenterId: 10,
      materialCostCents: 1200,
    });
    expect(batch.finishedParts).toHaveLength(1);
    expect(batch.finishedParts[0]).toMatchObject({
      partId: "p2",
      salesOrderId: 20,
      throughputCents: 3800,
    });
    // the allocation cursor advanced by the good unit only
    expect(batch.priorCounts.get(10)).toBe(1);
  });

  it("scraps the same units however the run is chunked", () => {
    const scrapRoute = (): Partial<RunState> => ({
      wipParts: [
        part("p1"),
        part("p2", { unitIndex: 1 }),
        part("p3", { unitIndex: 2 }),
      ],
      routingByWorkOrder: new Map([
        [
          10,
          {
            steps: [
              { workCenterId: 10, processTimeSeconds: 5, setupTimeSeconds: 0, scrapBps: 5000 },
              { workCenterId: 20, processTimeSeconds: 5, setupTimeSeconds: 0, scrapBps: 5000 },
            ],
          },
        ],
      ]),
    });
    const once = simulateBatch(state(scrapRoute()), 40);

    let carried = state(scrapRoute());
    const chunks = [];
    for (let i = 0; i < 4; i++) {
      const batch = simulateBatch(carried, 10);
      chunks.push(batch);
      carried = state({
        ...scrapRoute(),
        tickNum: batch.tickNum,
        wipParts: batch.wipParts,
        priorCounts: batch.priorCounts,
        setupDone: batch.setupDone,
      });
    }

    // half the units die somewhere on a two-step route; where must not depend
    // on how the advance was chunked
    expect(once.scrappedParts.length).toBeGreaterThan(0);
    expect(chunks.flatMap((b) => b.scrappedParts)).toEqual(once.scrappedParts);
    expect(chunks.flatMap((b) => b.finishedParts)).toEqual(once.finishedParts);
    expect(chunks.flatMap((b) => b.ticks)).toEqual(once.ticks);
  });

  it("is the same run again from the same seed, whatever the part ids are", () => {
    // the property the seed exists for. Part uuids are minted fresh at every
    // release, so while they were the draw key a re-created run drew different
    // noise and comparing two runs measured the dice, not the decision.
    const batchWith = (ids: [string, string]) =>
      simulateBatch(
        state({
          wipParts: [
            part(ids[0], { unitIndex: 0 }),
            part(ids[1], { unitIndex: 1 }),
          ],
        }),
        30,
      );

    const first = batchWith(["a1", "a2"]);
    const second = batchWith(["totally-different", "ids-entirely"]);

    expect(second.ticks).toEqual(first.ticks);
    expect(second.finishedParts.map((p) => p.completedAtTick)).toEqual(
      first.finishedParts.map((p) => p.completedAtTick),
    );
    expect(second.finishedParts.map((p) => p.throughputCents)).toEqual(
      first.finishedParts.map((p) => p.throughputCents),
    );
  });

  it("gives two units of one work order their own draws", () => {
    // same seed, same route, different unit index: the parts must not move in
    // lockstep, or the variance that is the point of the model is gone. Needs
    // two steps, because the only draw after release is at a transition.
    const batch = simulateBatch(
      state({
        wipParts: [
          part("p1", { unitIndex: 0 }),
          part("p2", { unitIndex: 1 }),
        ],
        routingByWorkOrder: new Map([
          [
            10,
            {
              steps: [
                { workCenterId: 10, processTimeSeconds: 5, setupTimeSeconds: 0, scrapBps: 0 },
                { workCenterId: 20, processTimeSeconds: 1000, setupTimeSeconds: 0, scrapBps: 0 },
              ],
            },
          ],
        ]),
        // capacity 2 so neither queues behind the other
        workCenters: new Map([
          [10, { id: 10, capacity: 2 }],
          [20, { id: 20, capacity: 2 }],
        ]),
      }),
      10,
    );

    const drawn = batch.wipParts.map((p) => p.actualProcessTimeSeconds);
    expect(drawn).toHaveLength(2);
    expect(drawn[0]).not.toBe(drawn[1]);
  });

  it("does nothing for a batch of zero ticks", () => {
    // a run that was just created has advanced nowhere, which is not an error
    const batch = simulateBatch(state({ tickNum: 7 }), 0);
    expect(batch).toMatchObject({
      tickNum: 7,
      wipParts: [],
      finishedParts: [],
      ticks: [],
    });
  });

  it("throws on a negative batch", () => {
    expect(() => simulateBatch(state(), -1)).toThrow(/-1 ticks/);
  });
});

describe("simulateBatch operating expense", () => {
  // a 10-tick day keeps the arithmetic readable; day length is data
  const costs = (overrides: Partial<CostRates> = {}): CostRates => ({
    ...freeCosts,
    ...overrides,
  });

  it("charges rent for ticks where nothing happened", () => {
    // the empty-floor test's comment made literal: time passing is expensive
    const batch = simulateBatch(
      state({ costs: costs({ facilityOverheadCentsPerDay: 50 }) }),
      10,
    );
    expect(batch.wipParts).toEqual([]);
    const charged = batch.ticks.reduce(
      (sum, tick) => sum + tick.operatingExpenseCents,
      0,
    );
    expect(charged).toBe(50);
    expect(batch.ticks.every((tick) => tick.carryingCostCents === 0)).toBe(true);
  });

  it("accrues a free factory nothing", () => {
    const batch = simulateBatch(state({ wipParts: [part("p1")] }), 10);
    for (const tick of batch.ticks) {
      expect(tick.operatingExpenseCents).toBe(0);
      expect(tick.carryingCostCents).toBe(0);
    }
    expect(batch.carryRemainder).toBe(0);
  });

  it("charges carrying on the end-of-tick floor, so a finishing part pays no rent for its last tick", () => {
    // 10000 bps/day of 1200c material over a 10-tick day = 120c per held tick
    const batch = simulateBatch(
      state({
        wipParts: [part("p1")],
        costs: costs({ wipCarryingBpsPerDay: 10_000 }),
      }),
      10,
    );

    const finishedAt = batch.finishedParts[0]?.completedAtTick;
    expect(finishedAt).toBeDefined();
    for (const tick of batch.ticks) {
      expect(tick.carryingCostCents).toBe(tick.tickNum < finishedAt! ? 120 : 0);
    }
  });

  it("splits identically across a rate dated mid-batch", () => {
    // a capital action takes the run's lock, so a real batch never *spans* a
    // change — but the accrual must stay a pure function of the tick number
    // for chunking to be safe at all, and a rate whose epoch falls inside the
    // batch is the sharpest test of that: nothing carries the segment across
    // a boundary, the tick number alone decides.
    const withDated = () =>
      state({
        wipParts: [part("p1"), part("p2", { unitIndex: 1 })],
        costs: costs({
          facilityOverheadCentsPerDay: 17,
          wipCarryingBpsPerDay: 333,
          standingCostByWorkCenter: new Map([[10, dated(60, 14)]]),
          wageCentsPerHourByWorkCenter: new Map([[10, dated(7200, 14)]]),
        }),
      });

    const once = simulateBatch(withDated(), 30);

    let carried = withDated();
    const chunks = [];
    for (let i = 0; i < 3; i++) {
      const batch = simulateBatch(carried, 10);
      chunks.push(batch);
      carried = {
        ...carried,
        tickNum: batch.tickNum,
        wipParts: batch.wipParts,
        priorCounts: batch.priorCounts,
        carryRemainder: batch.carryRemainder,
      };
    }

    expect(chunks.flatMap((b) => b.ticks)).toEqual(once.ticks);
    expect(chunks.at(-1)?.carryRemainder).toBe(once.carryRemainder);
    // and the dated rates really did start mid-run: nothing before tick 15
    const before = once.ticks.filter((tick) => tick.tickNum <= 14);
    expect(before.every((tick) => tick.wageCents === 0)).toBe(true);
    expect(
      once.ticks
        .filter((tick) => tick.tickNum > 14)
        .some((tick) => tick.wageCents > 0),
    ).toBe(true);
  });

  it("is the same run whether advanced in one batch or several, at nonzero rates", () => {
    // the zero-rate variant above can't see a dropped or double-counted
    // remainder; 333 bps over 1200c leaves one non-zero at every boundary
    const withRates = () =>
      state({
        wipParts: [part("p1"), part("p2", { unitIndex: 1 })],
        costs: costs({
          facilityOverheadCentsPerDay: 17,
          wipCarryingBpsPerDay: 333,
          standingCostByWorkCenter: new Map([
            [10, dated(7)],
            [20, dated(5)],
          ]),
          wageCentsPerHourByWorkCenter: new Map([
            [10, dated(7)],
            [20, dated(11)],
          ]),
        }),
      });

    const once = simulateBatch(withRates(), 30);

    let carried = withRates();
    const chunks = [];
    for (let i = 0; i < 3; i++) {
      const batch = simulateBatch(carried, 10);
      chunks.push(batch);
      expect(batch.carryRemainder).toBeGreaterThan(0);
      carried = {
        ...carried,
        tickNum: batch.tickNum,
        wipParts: batch.wipParts,
        priorCounts: batch.priorCounts,
        carryRemainder: batch.carryRemainder,
      };
    }

    expect(chunks.flatMap((b) => b.ticks)).toEqual(once.ticks);
    expect(chunks.flatMap((b) => b.finishedParts)).toEqual(once.finishedParts);
    expect(chunks.at(-1)?.carryRemainder).toBe(once.carryRemainder);
  });

  it("carries the remainder out without mutating the input state", () => {
    const input = state({
      wipParts: [part("p1")],
      costs: costs({ wipCarryingBpsPerDay: 333 }),
      carryRemainder: 41,
    });
    const batch = simulateBatch(input, 3);
    expect(input.carryRemainder).toBe(41);
    // 3 ticks of 1200c at 333 bps: 41 + 3·399600 = 1198841 = 11c + 98841
    expect(batch.carryRemainder).toBe(98_841);
    expect(
      batch.ticks.reduce((sum, tick) => sum + tick.carryingCostCents, 0),
    ).toBe(11);
  });

  it("accrues exactly the day's rates over a full day", () => {
    const batch = simulateBatch(
      state({
        costs: costs({
          facilityOverheadCentsPerDay: 100,
          standingCostByWorkCenter: new Map([
            [10, dated(33)],
            [20, dated(9)],
          ]),
        }),
      }),
      10,
    );
    expect(
      batch.ticks.reduce((sum, tick) => sum + tick.operatingExpenseCents, 0),
    ).toBe(142);
  });

  it("accrues exactly the hour's wage bills over a staffed hour", () => {
    const batch = simulateBatch(
      state({
        costs: costs({
          wageCentsPerHourByWorkCenter: new Map([
            [10, dated(100)],
            [20, dated(33)],
          ]),
        }),
      }),
      3600,
    );
    expect(batch.ticks.reduce((sum, tick) => sum + tick.wageCents, 0)).toBe(133);
    // and never into the expense column — the split is the point
    expect(
      batch.ticks.reduce((sum, tick) => sum + tick.operatingExpenseCents, 0),
    ).toBe(0);
  });

  it("throws when a work order's part is missing, before any tick runs", () => {
    expect(() =>
      simulateBatch(state({ parts: [] }), 1),
    ).toThrow("Work order 10 makes part 1, which was not loaded");
  });
});
