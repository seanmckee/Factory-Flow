import { describe, it, expect } from "vitest";
import { setupKey } from "./observations.js";
import type { CostRates } from "./operatingExpense.js";
import { unitDraw } from "./sampleProcessTime.js";
import { simulateBatch } from "./simulateBatch.js";
import type { Routing, WipPart, WorkCenter } from "./types.js";

const SEED = 42;

/** a free factory: the floor's rules are what these specs are about */
const FREE_COSTS: CostRates = {
  dayTicks: 28_800,
  facilityOverheadCentsPerDay: 0,
  wipCarryingBpsPerDay: 0,
  standingCostByWorkCenter: new Map(),
  wageCentsPerHourByWorkCenter: new Map(),
};

/**
 * One tick of the floor.
 *
 * These specs were written against a `simulateTick` that no longer exists: the
 * engine schedules completions rather than stepping seconds, so there is no
 * per-second entry point to call. They are kept **verbatim** and driven
 * through `simulateBatch` at a batch length of one, because what they pin is
 * the floor's rules — who claims a machine, who pays a changeover, what a
 * scrap draw ruins, what an observation counts — and the port changed none of
 * them. A rewrite that quietly redefined one would fail here, which is the
 * whole reason they were not rewritten alongside it.
 *
 * Driving the batch rather than reaching into the engine is deliberate too: it
 * is the seam production uses, so nothing here can pass against an engine the
 * run service cannot actually drive.
 */
function simulateTick(
  wipParts: WipPart[],
  routingByWorkOrder: Map<number, Routing>,
  tickNum: number,
  workCenters: Map<number, WorkCenter>,
  rngSeed: number,
  setupDone: ReadonlySet<string> = new Set(),
) {
  const batch = simulateBatch(
    {
      tickNum: tickNum - 1,
      rngSeed,
      wipParts,
      routingByWorkOrder,
      workCenters,
      // every work order on the floor makes the same free part: these specs
      // are about the floor, and `calculateThroughput` has its own suite
      workOrders: [...new Set(wipParts.map((part) => part.workOrderId))].map(
        (id) => ({ id, partId: 1 }),
      ),
      parts: [{ id: 1, materialCostCents: 0 }],
      salesOrders: [],
      allocations: [],
      costs: FREE_COSTS,
      carryRemainder: 0,
      setupDone,
      priorCounts: new Map(),
    },
    1,
  );

  const observed = batch.ticks[0];
  if (!observed) throw new Error("a one-tick batch emitted no observation");
  return {
    wipParts: batch.wipParts,
    finishedParts: batch.finishedParts.map((part) => ({
      id: part.partId,
      workOrderId: part.workOrderId,
      releasedAtTick: part.releasedAtTick,
      completedAtTick: part.completedAtTick,
    })),
    scrappedParts: batch.scrappedParts.map((part) => ({
      id: part.partId,
      workOrderId: part.workOrderId,
      unitIndex: part.unitIndex,
      releasedAtTick: part.releasedAtTick,
      scrappedAtTick: part.scrappedAtTick,
      stepIndex: part.stepIndex,
      workCenterId: part.workCenterId,
    })),
    setupsStarted: batch.setupsStarted.map(({ workOrderId, stepIndex }) => ({
      workOrderId,
      stepIndex,
    })),
    metrics: {
      tickNum: observed.tickNum,
      wipCount: observed.wipCount,
      workCenters: observed.workCenters,
    },
  };
}

const testRouting: Routing = {
  steps: [
    { workCenterId: 10, processTimeSeconds: 5, setupTimeSeconds: 0, scrapBps: 0 },
    { workCenterId: 20, processTimeSeconds: 5, setupTimeSeconds: 0, scrapBps: 0 },
  ],
};

/** keyed by work order id, as the engine reads it */
const testRoutings = new Map<number, Routing>([[1, testRouting]]);

const makeWorkCenters = (firstStepCapacity: number) =>
  new Map<number, WorkCenter>([
    [10, { id: 10, capacity: firstStepCapacity }],
    [20, { id: 20, capacity: 1 }],
  ]);

const testWorkCenters = makeWorkCenters(1);

const makeWipPart = (id: string, overrides: Partial<WipPart> = {}): WipPart => ({
  id,
  workOrderId: 1,
  unitIndex: 0,
  releasedAtTick: 0,
  stepIndex: 0,
  progressSeconds: 0,
  actualProcessTimeSeconds: 5,
  ...overrides,
});

const tick = (
  wipParts: WipPart[],
  workCenters = testWorkCenters,
  tickNum = 1,
  seed = SEED,
) => simulateTick(wipParts, testRoutings, tickNum, workCenters, seed);

describe("the floor, one tick at a time", () => {
  it("advances a part's progress by 1 second per tick", () => {
    const result = tick([makeWipPart("part-1")]);
    expect(result.wipParts[0]?.progressSeconds).toBe(1);
  });

  it("does not mutate the parts it is given", () => {
    const part = makeWipPart("part-1");
    tick([part]);
    expect(part.progressSeconds).toBe(0);
  });

  it("only advances one part per work center (capacity of 1)", () => {
    const result = tick([makeWipPart("part-1"), makeWipPart("part-2")]);
    expect(result.wipParts[0]?.progressSeconds).toBe(1);
    expect(result.wipParts[1]?.progressSeconds).toBe(0);
  });

  it("moves to next step when process time completes", () => {
    const result = tick([makeWipPart("part-1", { progressSeconds: 4 })]);
    expect(result.wipParts[0]?.stepIndex).toBe(1);
    expect(result.wipParts[0]?.progressSeconds).toBe(0);
  });

  it("finished part leaves wipParts and appears in finishedParts", () => {
    const result = tick(
      [makeWipPart("part-1", { stepIndex: 1, progressSeconds: 4 })],
      testWorkCenters,
      7,
    );
    expect(result.finishedParts).toEqual([
      { id: "part-1", workOrderId: 1, releasedAtTick: 0, completedAtTick: 7 },
    ]);
    expect(result.wipParts.length).toBe(0);
  });

  it("advances up to capacity parts at a work center", () => {
    const result = tick(
      [makeWipPart("part-1"), makeWipPart("part-2"), makeWipPart("part-3")],
      makeWorkCenters(2),
    );

    expect(result.wipParts.filter((w) => w.progressSeconds === 1).length).toBe(2);
    expect(result.wipParts.filter((w) => w.progressSeconds === 0).length).toBe(1);
  });

  it("capacity of 1 still admits only one waiting part", () => {
    const result = tick(
      [makeWipPart("part-1"), makeWipPart("part-2")],
      makeWorkCenters(1),
    );
    expect(result.wipParts.filter((w) => w.progressSeconds === 1).length).toBe(1);
  });

  it("a part already in service holds one machine, not two", () => {
    const result = tick(
      [
        makeWipPart("part-1", { progressSeconds: 2 }),
        makeWipPart("part-2"),
        makeWipPart("part-3"),
      ],
      makeWorkCenters(2),
    );

    const byId = new Map(result.wipParts.map((w) => [w.id, w]));
    // the in-service part keeps running on its machine
    expect(byId.get("part-1")?.progressSeconds).toBe(3);
    // only one machine was left free, so exactly one waiter is admitted
    const admittedWaiters = ["part-2", "part-3"].filter(
      (id) => byId.get(id)?.progressSeconds === 1,
    );
    expect(admittedWaiters.length).toBe(1);
  });

  it("draws a new process time for the step it moves onto", () => {
    const result = tick([makeWipPart("part-1", { progressSeconds: 4 })]);
    const actual = result.wipParts[0]?.actualProcessTimeSeconds ?? 0;
    // nominal 5, ±30%
    expect(actual).toBeGreaterThanOrEqual(4);
    expect(actual).toBeLessThanOrEqual(7);
  });

  it("reproduces the same draw from the same seed", () => {
    const draw = (seed: number) =>
      tick(
        [makeWipPart("part-1", { progressSeconds: 4 })],
        testWorkCenters,
        1,
        seed,
      ).wipParts[0]?.actualProcessTimeSeconds;

    expect(draw(SEED)).toBe(draw(SEED));
  });

  it("draws independently per part, not once per step", () => {
    // a long nominal time so two draws colliding after rounding is unlikely
    const routings = new Map<number, Routing>([
      [
        1,
        {
          steps: [
            { workCenterId: 10, processTimeSeconds: 5, setupTimeSeconds: 0, scrapBps: 0 },
            { workCenterId: 20, processTimeSeconds: 1000, setupTimeSeconds: 0, scrapBps: 0 },
          ],
        },
      ],
    ]);
    // distinct unit indices, as a release assigns them: the unit index is what
    // separates two parts' luck now that the draw key holds no uuid
    const result = simulateTick(
      [
        makeWipPart("part-1", { unitIndex: 0, progressSeconds: 4 }),
        makeWipPart("part-2", { unitIndex: 1, progressSeconds: 4 }),
      ],
      routings,
      1,
      makeWorkCenters(2),
      SEED,
    );

    const [first, second] = result.wipParts;
    expect(first?.stepIndex).toBe(1);
    expect(second?.stepIndex).toBe(1);
    expect(first?.actualProcessTimeSeconds).not.toBe(
      second?.actualProcessTimeSeconds,
    );
  });

  describe("when a routing has been shortened under an in-flight part", () => {
    const shortened = new Map<number, Routing>([
      [1, { steps: [{ workCenterId: 10, processTimeSeconds: 5, setupTimeSeconds: 0, scrapBps: 0 }] }],
    ]);

    it("finishes the stranded part at the current tick", () => {
      const result = simulateTick(
        [makeWipPart("part-1", { stepIndex: 1, progressSeconds: 3 })],
        shortened,
        9,
        testWorkCenters,
        SEED,
      );

      expect(result.finishedParts).toEqual([
        { id: "part-1", workOrderId: 1, releasedAtTick: 0, completedAtTick: 9 },
      ]);
      expect(result.wipParts.length).toBe(0);
    });

    it("does not let the stranded part hold a machine on its way out", () => {
      const result = simulateTick(
        [
          makeWipPart("stranded", { stepIndex: 1, progressSeconds: 3 }),
          makeWipPart("part-2"),
        ],
        shortened,
        1,
        testWorkCenters,
        SEED,
      );

      expect(result.wipParts[0]?.progressSeconds).toBe(1);
    });
  });

  it("throws when a part's work order has no pinned routing", () => {
    expect(() =>
      simulateTick([makeWipPart("part-1")], new Map(), 1, testWorkCenters, SEED),
    ).toThrow(/work order 1/);
  });

  it("follows each work order's own pinned steps, not a shared routing", () => {
    // two work orders off the same routing, released either side of an edit
    // that moved the second operation to a different work center
    const pinned = new Map<number, Routing>([
      [
        1,
        { steps: [{ workCenterId: 10, processTimeSeconds: 5, setupTimeSeconds: 0, scrapBps: 0 }] },
      ],
      [
        2,
        { steps: [{ workCenterId: 20, processTimeSeconds: 5, setupTimeSeconds: 0, scrapBps: 0 }] },
      ],
    ]);
    const before = makeWipPart("part-before", { workOrderId: 1 });
    const after = makeWipPart("part-after", { workOrderId: 2 });

    const result = simulateTick([before, after], pinned, 1, testWorkCenters, SEED);

    // each claimed a machine at its own center, so both advanced despite
    // capacity 1 everywhere — proof they are not reading the same step list
    expect(result.wipParts.map((p) => p.progressSeconds)).toEqual([1, 1]);
    const busy = new Map(
      result.metrics.workCenters.map((wc) => [wc.workCenterId, wc.busy]),
    );
    expect(busy.get(10)).toBe(1);
    expect(busy.get(20)).toBe(1);
  });

  it("throws when a step's work center was not loaded", () => {
    expect(() =>
      simulateTick([makeWipPart("part-1")], testRoutings, 1, new Map(), SEED),
    ).toThrow(/work center 10/);
  });

  it("carries releasedAtTick from the part onto the finished record", () => {
    const result = tick(
      [
        makeWipPart("part-1", {
          releasedAtTick: 12,
          stepIndex: 1,
          progressSeconds: 4,
        }),
      ],
      testWorkCenters,
      20,
    );

    expect(result.finishedParts).toEqual([
      { id: "part-1", workOrderId: 1, releasedAtTick: 12, completedAtTick: 20 },
    ]);
  });

  describe("setup", () => {
    // step 0 carries a 3-second changeover; step 1 carries none
    const withSetup = new Map<number, Routing>([
      [
        1,
        {
          steps: [
            { workCenterId: 10, processTimeSeconds: 5, setupTimeSeconds: 3, scrapBps: 0 },
            { workCenterId: 20, processTimeSeconds: 5, setupTimeSeconds: 0, scrapBps: 0 },
          ],
        },
      ],
    ]);
    const setupTick = (
      wipParts: WipPart[],
      workCenters = testWorkCenters,
      setupDone?: ReadonlySet<string>,
    ) => simulateTick(wipParts, withSetup, 1, workCenters, SEED, setupDone);

    it("folds the changeover into the first admitted unit's process time", () => {
      const result = setupTick([makeWipPart("part-1")]);

      expect(result.wipParts[0]?.actualProcessTimeSeconds).toBe(8);
      // the setup consumes machine time, but admission still progresses it
      expect(result.wipParts[0]?.progressSeconds).toBe(1);
      expect(result.setupsStarted).toEqual([{ workOrderId: 1, stepIndex: 0 }]);
    });

    it("lets every later unit of the work order process clean", () => {
      const result = setupTick(
        [makeWipPart("part-1"), makeWipPart("part-2", { unitIndex: 1 })],
        makeWorkCenters(2),
      );

      expect(result.wipParts.map((p) => p.actualProcessTimeSeconds)).toEqual([
        8, 5,
      ]);
      expect(result.setupsStarted).toHaveLength(1);
    });

    it("charges nothing to a unit still waiting for a machine", () => {
      const result = setupTick([
        makeWipPart("part-1"),
        makeWipPart("part-2", { unitIndex: 1 }),
      ]);

      const queued = result.wipParts.find((p) => p.id === "part-2");
      expect(queued?.actualProcessTimeSeconds).toBe(5);
      expect(result.setupsStarted).toHaveLength(1);
    });

    it("never re-charges a changeover already recorded as paid", () => {
      const result = setupTick(
        [makeWipPart("part-1")],
        testWorkCenters,
        new Set([setupKey(1, 0)]),
      );

      expect(result.wipParts[0]?.actualProcessTimeSeconds).toBe(5);
      expect(result.setupsStarted).toEqual([]);
    });

    it("never charges a part already mid-process at the step", () => {
      // a pre-6C run reloads with parts mid-step and no setup rows at all;
      // a unit that has already started is by definition past any changeover
      const result = setupTick([makeWipPart("part-1", { progressSeconds: 2 })]);

      expect(result.wipParts[0]?.actualProcessTimeSeconds).toBe(5);
      expect(result.setupsStarted).toEqual([]);
    });

    it("charges each work order its own changeover at a shared center", () => {
      const pinned = new Map<number, Routing>([
        [1, { steps: [{ workCenterId: 10, processTimeSeconds: 5, setupTimeSeconds: 3, scrapBps: 0 }] }],
        [2, { steps: [{ workCenterId: 10, processTimeSeconds: 5, setupTimeSeconds: 3, scrapBps: 0 }] }],
      ]);
      const result = simulateTick(
        [makeWipPart("part-1"), makeWipPart("part-2", { workOrderId: 2 })],
        pinned,
        1,
        makeWorkCenters(2),
        SEED,
      );

      expect(result.wipParts.map((p) => p.actualProcessTimeSeconds)).toEqual([
        8, 8,
      ]);
      expect(result.setupsStarted).toEqual([
        { workOrderId: 1, stepIndex: 0 },
        { workOrderId: 2, stepIndex: 0 },
      ]);
    });

    it("charges one changeover when capacity admits two fresh units at once", () => {
      const result = setupTick(
        [makeWipPart("part-1"), makeWipPart("part-2", { unitIndex: 1 })],
        makeWorkCenters(2),
      );

      expect(result.setupsStarted).toEqual([{ workOrderId: 1, stepIndex: 0 }]);
    });

    it("reports no changeover for a zero setup time", () => {
      // zero is a legitimate setup time meaning "none", and recording it would
      // write a row per (work order, step) for steps that need no changeover
      const result = tick([makeWipPart("part-1")]);
      expect(result.setupsStarted).toEqual([]);
    });

    it("draws a transition clean and charges the setup at the next admission", () => {
      const twoSetups = new Map<number, Routing>([
        [
          1,
          {
            steps: [
              { workCenterId: 10, processTimeSeconds: 5, setupTimeSeconds: 0, scrapBps: 0 },
              { workCenterId: 20, processTimeSeconds: 5, setupTimeSeconds: 3, scrapBps: 0 },
            ],
          },
        ],
      ]);
      const first = simulateTick(
        [makeWipPart("part-1", { progressSeconds: 4 })],
        twoSetups,
        1,
        testWorkCenters,
        SEED,
      );
      // the transition drew the step's own time; no machine at 20 was claimed
      const drawn = first.wipParts[0]?.actualProcessTimeSeconds ?? 0;
      expect(first.setupsStarted).toEqual([]);
      expect(drawn).toBeGreaterThanOrEqual(4);
      expect(drawn).toBeLessThanOrEqual(7);

      const second = simulateTick(
        first.wipParts,
        twoSetups,
        2,
        testWorkCenters,
        SEED,
      );
      expect(second.setupsStarted).toEqual([{ workOrderId: 1, stepIndex: 1 }]);
      expect(second.wipParts[0]?.actualProcessTimeSeconds).toBe(drawn + 3);
    });
  });

  describe("scrap", () => {
    // step 0 ruins everything it completes; step 1 is clean
    const scrapAll = new Map<number, Routing>([
      [
        1,
        {
          steps: [
            { workCenterId: 10, processTimeSeconds: 5, setupTimeSeconds: 0, scrapBps: 10000 },
            { workCenterId: 20, processTimeSeconds: 5, setupTimeSeconds: 0, scrapBps: 0 },
          ],
        },
      ],
    ]);

    it("a unit failing its draw leaves as scrap, never as a finished part", () => {
      const result = simulateTick(
        [makeWipPart("part-1", { progressSeconds: 4 })],
        scrapAll,
        9,
        testWorkCenters,
        SEED,
      );

      expect(result.finishedParts).toEqual([]);
      expect(result.wipParts).toEqual([]);
      expect(result.scrappedParts).toEqual([
        {
          id: "part-1",
          workOrderId: 1,
          unitIndex: 0,
          releasedAtTick: 0,
          scrappedAtTick: 9,
          stepIndex: 0,
          workCenterId: 10,
        },
      ]);
    });

    it("scraps at the last step rather than finishing", () => {
      const lastStepScraps = new Map<number, Routing>([
        [
          1,
          {
            steps: [
              { workCenterId: 10, processTimeSeconds: 5, setupTimeSeconds: 0, scrapBps: 0 },
              { workCenterId: 20, processTimeSeconds: 5, setupTimeSeconds: 0, scrapBps: 10000 },
            ],
          },
        ],
      ]);
      const result = simulateTick(
        [makeWipPart("part-1", { stepIndex: 1, progressSeconds: 4 })],
        lastStepScraps,
        1,
        testWorkCenters,
        SEED,
      );

      expect(result.finishedParts).toEqual([]);
      expect(result.scrappedParts).toHaveLength(1);
      expect(result.scrappedParts[0]?.stepIndex).toBe(1);
      expect(result.scrappedParts[0]?.workCenterId).toBe(20);
    });

    it("counts the machine the unit died on as busy, and the unit as no WIP", () => {
      const result = simulateTick(
        [makeWipPart("part-1", { progressSeconds: 4 })],
        scrapAll,
        1,
        testWorkCenters,
        SEED,
      );

      // the whole tick was worked — the exact undercount a snapshot makes
      const wc10 = result.metrics.workCenters.find((wc) => wc.workCenterId === 10);
      expect(wc10?.busy).toBe(1);
      expect(result.metrics.wipCount).toBe(0);
    });

    it("a unit mid-step is not drawn against until it completes", () => {
      const result = simulateTick(
        [makeWipPart("part-1", { progressSeconds: 1 })],
        scrapAll,
        1,
        testWorkCenters,
        SEED,
      );

      expect(result.scrappedParts).toEqual([]);
      expect(result.wipParts).toHaveLength(1);
    });

    it("ruins exactly the units whose draws fall under the step's rate", () => {
      // rig the rate between the two units' own scrap draws, so which unit
      // dies is forced by the seeded RNG rather than by 0%/100% edge cases
      const d0 = unitDraw({ seed: SEED, workOrderId: 1, unitIndex: 0, stepIndex: 0 }, "scrap");
      const d1 = unitDraw({ seed: SEED, workOrderId: 1, unitIndex: 1, stepIndex: 0 }, "scrap");
      const bps = Math.floor(Math.min(d0, d1) * 10000) + 1;
      expect(Math.max(d0, d1)).toBeGreaterThanOrEqual(bps / 10000);

      const rigged = new Map<number, Routing>([
        [
          1,
          {
            steps: [
              { workCenterId: 10, processTimeSeconds: 5, setupTimeSeconds: 0, scrapBps: bps },
              { workCenterId: 20, processTimeSeconds: 5, setupTimeSeconds: 0, scrapBps: 0 },
            ],
          },
        ],
      ]);
      const result = simulateTick(
        [
          makeWipPart("part-1", { unitIndex: 0, progressSeconds: 4 }),
          makeWipPart("part-2", { unitIndex: 1, progressSeconds: 4 }),
        ],
        rigged,
        1,
        makeWorkCenters(2),
        SEED,
      );

      expect(result.scrappedParts).toHaveLength(1);
      expect(result.scrappedParts[0]?.unitIndex).toBe(d0 < d1 ? 0 : 1);
      expect(result.wipParts).toHaveLength(1);
      expect(result.wipParts[0]?.stepIndex).toBe(1);
    });
  });

  describe("metrics", () => {
    const at = (result: ReturnType<typeof tick>, workCenterId: number) =>
      result.metrics.workCenters.find((wc) => wc.workCenterId === workCenterId);

    it("reports one entry per work center, including idle ones", () => {
      const result = tick([makeWipPart("part-1")]);

      expect(result.metrics.workCenters.map((wc) => wc.workCenterId)).toEqual([
        10, 20,
      ]);
      expect(result.metrics.tickNum).toBe(1);
      expect(at(result, 20)).toEqual({
        workCenterId: 20,
        busy: 0,
        queued: 0,
        capacity: 1,
      });
    });

    it("counts machines in use, not parts at the center", () => {
      const result = tick(
        [makeWipPart("part-1"), makeWipPart("part-2"), makeWipPart("part-3")],
        makeWorkCenters(2),
      );

      expect(at(result, 10)).toEqual({
        workCenterId: 10,
        busy: 2,
        queued: 1,
        capacity: 2,
      });
    });

    it("counts a part that claimed no machine as queued", () => {
      const result = tick([makeWipPart("part-1"), makeWipPart("part-2")]);

      expect(at(result, 10)).toEqual({
        workCenterId: 10,
        busy: 1,
        queued: 1,
        capacity: 1,
      });
    });

    it("counts the machine a part finished on as busy", () => {
      // the case a post-tick snapshot cannot see: the part held the machine for
      // the whole tick and is gone from wipParts by the time anyone looks
      const result = tick([
        makeWipPart("part-1", { stepIndex: 1, progressSeconds: 4 }),
      ]);

      expect(result.wipParts).toEqual([]);
      expect(at(result, 20)?.busy).toBe(1);
    });

    it("reports the parts left on the floor as wipCount", () => {
      const result = tick([
        makeWipPart("part-1", { stepIndex: 1, progressSeconds: 4 }),
        makeWipPart("part-2"),
        makeWipPart("part-3"),
      ]);

      expect(result.metrics.wipCount).toBe(2);
      expect(result.metrics.wipCount).toBe(result.wipParts.length);
    });

    it("counts a part stranded by a shortened routing as neither", () => {
      const shortened = new Map<number, Routing>([
        [1, { steps: [{ workCenterId: 10, processTimeSeconds: 5, setupTimeSeconds: 0, scrapBps: 0 }] }],
      ]);
      const result = simulateTick(
        [makeWipPart("stranded", { stepIndex: 1, progressSeconds: 3 })],
        shortened,
        1,
        testWorkCenters,
        SEED,
      );

      expect(result.finishedParts.length).toBe(1);
      expect(result.metrics.wipCount).toBe(0);
      expect(result.metrics.workCenters).toEqual([
        { workCenterId: 10, busy: 0, queued: 0, capacity: 1 },
        { workCenterId: 20, busy: 0, queued: 0, capacity: 1 },
      ]);
    });
  });
});

/**
 * The engine does not evaluate every tick — it jumps to the next one that can
 * differ, and repeats the observation across the quiet stretch between. That
 * shortcut is the whole point of the port, and it is only sound if "can
 * differ" is right.
 *
 * It was not, in the first cut: the test asked whether anything had **left the
 * floor**, which misses the commonest event there is. A unit moving to its
 * next step frees the machine behind it and joins a queue ahead of it without
 * finishing or scrapping, so a floor whose parts were all mid-route simply
 * froze — every later tick a copy of the one the transition happened on. The
 * randomized differential sweep against the old engine is what caught it.
 */
describe("waking on the next tick that can differ", () => {
  const twoSteps = new Map<number, Routing>([
    [
      1,
      {
        steps: [
          { workCenterId: 10, processTimeSeconds: 3, setupTimeSeconds: 0, scrapBps: 0 },
          { workCenterId: 20, processTimeSeconds: 5, setupTimeSeconds: 0, scrapBps: 0 },
        ],
      },
    ],
  ]);
  const singles = new Map<number, WorkCenter>([
    [10, { id: 10, capacity: 1 }],
    [20, { id: 20, capacity: 1 }],
  ]);

  const observationsOf = (ticks: number) =>
    simulateBatch(
      {
        tickNum: 0,
        rngSeed: SEED,
        wipParts: [
          makeWipPart("part-1", { actualProcessTimeSeconds: 3 }),
          makeWipPart("part-2", { unitIndex: 1, actualProcessTimeSeconds: 3 }),
        ],
        routingByWorkOrder: twoSteps,
        workCenters: singles,
        workOrders: [{ id: 1, partId: 1 }],
        parts: [{ id: 1, materialCostCents: 0 }],
        salesOrders: [],
        allocations: [],
        costs: FREE_COSTS,
        carryRemainder: 0,
        setupDone: new Set<string>(),
        priorCounts: new Map(),
      },
      ticks,
    ).ticks;

  it("frees the machine behind a part that only moved on", () => {
    const observed = observationsOf(6);

    // tick 3: part-1 finishes the first step still holding its machine, with
    // part-2 queued behind it and the second center untouched
    expect(observed[2]?.workCenters).toEqual([
      { workCenterId: 10, busy: 1, queued: 1, capacity: 1 },
      { workCenterId: 20, busy: 0, queued: 0, capacity: 1 },
    ]);
    // tick 4: both machines run — the one part-1 vacated, and the one it moved
    // onto. Reading tick 3 as "nothing left the floor" stalls both.
    expect(observed[3]?.workCenters).toEqual([
      { workCenterId: 10, busy: 1, queued: 0, capacity: 1 },
      { workCenterId: 20, busy: 1, queued: 0, capacity: 1 },
    ]);
  });

  it("keeps the floor moving rather than repeating the transition tick", () => {
    // the bug's signature: with nothing finishing and nothing scrapping, every
    // tick after the transition was a copy of it
    const observed = observationsOf(20);
    const second = observed.filter((tick) => tick.workCenters[1]!.busy > 0);
    expect(second.length).toBeGreaterThan(1);
  });
});
