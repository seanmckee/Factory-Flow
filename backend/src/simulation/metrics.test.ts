import { describe, it, expect } from "vitest";
import {
  aggregateCycleTime,
  aggregateMetrics,
  aggregateOnTimeDelivery,
  aggregateScrap,
  groupDeliveryBySalesOrder,
} from "./metrics.js";
import { bucketTicks } from "./observationBuckets.js";
import { simulateTick } from "./simulationTick.js";
import type { TickMetrics } from "./simulationTick.js";
import type { FinishedPart, Routing, WipPart, WorkCenter } from "./types.js";

const makeWorkCenters = (...centers: [id: number, capacity: number][]) =>
  new Map<number, WorkCenter>(
    centers.map(([id, capacity]) => [id, { id, capacity }]),
  );

const testWorkCenters = makeWorkCenters([10, 1], [20, 1]);

/**
 * One tick's observations. `at` is `[busy, queued, capacity]` per work center,
 * capacity defaulting to the single machine most of these tests want — it is
 * per observation because 6E lets it move mid-run.
 */
const makeTick = (
  tickNum: number,
  wipCount: number,
  at: Record<number, [busy: number, queued: number, capacity?: number]>,
): TickMetrics => ({
  tickNum,
  wipCount,
  workCenters: Object.entries(at).map(([id, [busy, queued, capacity = 1]]) => ({
    workCenterId: Number(id),
    busy,
    queued,
    capacity,
  })),
});

/**
 * Aggregate a hand-built tick series. `width` is the grid the observations are
 * stored on, and defaults to 1 — a bucket per tick, the identity — because
 * every figure below must come out the same however the same ticks were
 * grouped. The width-invariance tests at the bottom are what pin that.
 */
const aggregate = (
  series: TickMetrics[],
  workCenters: Map<number, WorkCenter>,
  width = 1,
) => aggregateMetrics(bucketTicks(series, width), workCenters);

const at = (result: ReturnType<typeof aggregate>, workCenterId: number) =>
  result.workCenters.find((wc) => wc.workCenterId === workCenterId);

describe("aggregateMetrics", () => {
  it("divides busy machine-ticks by capacity times ticks", () => {
    const centers = makeWorkCenters([10, 2]);
    const result = aggregate(
      [
        makeTick(1, 3, { 10: [2, 1, 2] }),
        makeTick(2, 3, { 10: [2, 1, 2] }),
        makeTick(3, 2, { 10: [1, 0, 2] }),
        makeTick(4, 0, { 10: [0, 0, 2] }),
      ],
      centers,
    );

    // 5 machine-ticks worked out of 2 machines x 4 ticks
    expect(at(result, 10)?.busyMachineTicks).toBe(5);
    expect(at(result, 10)?.capacityTicks).toBe(8);
    expect(at(result, 10)?.utilization).toBe(5 / 8);
  });

  it("divides by each observation's own capacity, not the current one", () => {
    // the centre ran one machine flat out for two ticks, then a purchase gave
    // it a second and both ran flat out for two more. It was saturated
    // throughout, and that is what the window must say — dividing all four
    // ticks by today's two machines would read 75% and hide the constraint in
    // exactly the window opened to judge the purchase.
    const result = aggregate(
      [
        makeTick(1, 4, { 10: [1, 3, 1] }),
        makeTick(2, 4, { 10: [1, 3, 1] }),
        makeTick(3, 4, { 10: [2, 2, 2] }),
        makeTick(4, 4, { 10: [2, 2, 2] }),
      ],
      makeWorkCenters([10, 2]),
    );

    expect(at(result, 10)?.busyMachineTicks).toBe(6);
    expect(at(result, 10)?.capacityTicks).toBe(6);
    expect(at(result, 10)?.utilization).toBe(1);
  });

  it("reads a centre retired to no machines as zero, not as a division by zero", () => {
    const result = aggregate(
      [makeTick(1, 0, { 10: [0, 0, 0] }), makeTick(2, 0, { 10: [0, 0, 0] })],
      makeWorkCenters([10, 0]),
    );

    expect(at(result, 10)?.capacityTicks).toBe(0);
    expect(at(result, 10)?.utilization).toBe(0);
    expect(at(result, 10)?.observedTicks).toBe(2);
  });

  it("reports a saturated center as fully utilized", () => {
    const result = aggregate(
      [makeTick(1, 1, { 10: [1, 0] }), makeTick(2, 1, { 10: [1, 0] })],
      makeWorkCenters([10, 1]),
    );

    expect(at(result, 10)?.utilization).toBe(1);
  });

  it("gives a fraction an instantaneous snapshot cannot", () => {
    // the whole point of a window: busy on 1 of 3 ticks is 0.33, not 0 or 1
    const result = aggregate(
      [
        makeTick(1, 1, { 10: [1, 0] }),
        makeTick(2, 0, { 10: [0, 0] }),
        makeTick(3, 0, { 10: [0, 0] }),
      ],
      makeWorkCenters([10, 1]),
    );

    expect(at(result, 10)?.utilization).toBeCloseTo(1 / 3);
  });

  it("reports the window's bounds and length", () => {
    const result = aggregate(
      [
        makeTick(400, 0, { 10: [0, 0], 20: [0, 0] }),
        makeTick(401, 0, { 10: [0, 0], 20: [0, 0] }),
      ],
      testWorkCenters,
    );

    expect(result.fromTick).toBe(400);
    expect(result.toTick).toBe(401);
    expect(result.tickCount).toBe(2);
  });

  it("reports mean, peak and final WIP", () => {
    const result = aggregate(
      [
        makeTick(1, 2, { 10: [1, 1] }),
        makeTick(2, 8, { 10: [1, 7] }),
        makeTick(3, 5, { 10: [1, 4] }),
      ],
      makeWorkCenters([10, 1]),
    );

    expect(result.meanWip).toBe(5);
    expect(result.maxWip).toBe(8);
    expect(result.finalWip).toBe(5);
  });

  it("reports mean and worst queue depth", () => {
    const result = aggregate(
      [
        makeTick(1, 3, { 10: [1, 2] }),
        makeTick(2, 7, { 10: [1, 6] }),
        makeTick(3, 2, { 10: [1, 1] }),
      ],
      makeWorkCenters([10, 1]),
    );

    expect(at(result, 10)?.meanQueueDepth).toBe(3);
    expect(at(result, 10)?.maxQueueDepth).toBe(6);
  });

  it("lists a work center the window never saw, with zeroes", () => {
    const result = aggregate(
      [makeTick(1, 1, { 10: [1, 0] })],
      testWorkCenters,
    );

    expect(at(result, 20)).toEqual({
      workCenterId: 20,
      utilization: 0,
      busyMachineTicks: 0,
      capacityTicks: 0,
      meanQueueDepth: 0,
      maxQueueDepth: 0,
      observedTicks: 0,
    });
  });

  it("divides by the ticks a center was observed, not the whole window", () => {
    // work center 20 was created halfway through the run; it was not idle
    // before that, it did not exist
    const result = aggregate(
      [
        makeTick(1, 1, { 10: [1, 0] }),
        makeTick(2, 1, { 10: [1, 0] }),
        makeTick(3, 1, { 10: [0, 0], 20: [1, 0] }),
        makeTick(4, 1, { 10: [0, 0], 20: [1, 0] }),
      ],
      testWorkCenters,
    );

    expect(at(result, 20)?.observedTicks).toBe(2);
    expect(at(result, 20)?.utilization).toBe(1);
    // and the whole-window centre is unaffected
    expect(at(result, 10)?.observedTicks).toBe(4);
    expect(at(result, 10)?.utilization).toBe(0.5);
  });

  it("reports zeroes and null bounds for a run that has not advanced", () => {
    const result = aggregate([], testWorkCenters);

    expect(result).toEqual({
      fromTick: null,
      toTick: null,
      tickCount: 0,
      meanWip: 0,
      maxWip: 0,
      finalWip: 0,
      workCenters: [
        {
          workCenterId: 10,
          utilization: 0,
          busyMachineTicks: 0,
          capacityTicks: 0,
          meanQueueDepth: 0,
          maxQueueDepth: 0,
          observedTicks: 0,
        },
        {
          workCenterId: 20,
          utilization: 0,
          busyMachineTicks: 0,
          capacityTicks: 0,
          meanQueueDepth: 0,
          maxQueueDepth: 0,
          observedTicks: 0,
        },
      ],
    });
  });

  it("throws when a tick reports a work center that was not loaded", () => {
    expect(() =>
      aggregate(
        [makeTick(3, 1, { 99: [1, 0] })],
        testWorkCenters,
      ),
    ).toThrow(/work center 99/);
  });

  it("aggregates what simulateTick actually emits", () => {
    // guards the seam: the tick must keep reporting every center every tick,
    // or these denominators quietly change meaning
    const routings = new Map<number, Routing>([
      [
        1,
        {
          steps: [
            { workCenterId: 10, processTimeSeconds: 5, setupTimeSeconds: 0, scrapBps: 0 },
            { workCenterId: 20, processTimeSeconds: 5, setupTimeSeconds: 0, scrapBps: 0 },
          ],
        },
      ],
    ]);
    let wipParts: WipPart[] = [
      {
        id: "part-1",
        workOrderId: 1,
        unitIndex: 0,
        releasedAtTick: 0,
        stepIndex: 0,
        progressSeconds: 0,
        actualProcessTimeSeconds: 3,
      },
    ];

    const series: TickMetrics[] = [];
    for (let tickNum = 1; tickNum <= 3; tickNum++) {
      const result = simulateTick(wipParts, routings, tickNum, testWorkCenters, 42);
      wipParts = result.wipParts;
      series.push(result.metrics);
    }

    const result = aggregate(series, testWorkCenters);

    expect(result.tickCount).toBe(3);
    // the part held work center 10 for all three ticks, then moved on
    expect(at(result, 10)?.utilization).toBe(1);
    expect(at(result, 20)?.utilization).toBe(0);
    expect(result.meanWip).toBe(1);
  });

  /**
   * The property 6G's storage change rests on: bucketing is a storage
   * resolution, not a reporting one. Every figure the aggregate reports is a
   * sum, a count or a max, so grouping the same ticks differently cannot move
   * any of them — which is what makes 60× fewer rows a free change rather than
   * a precision trade.
   */
  describe("is invariant to the bucket width", () => {
    // deliberately jagged: WIP peaks mid-bucket and ends elsewhere, capacity
    // moves at tick 5 (a 6E purchase), and center 20 arrives late
    const series: TickMetrics[] = [
      makeTick(1, 4, { 10: [1, 0, 1] }),
      makeTick(2, 9, { 10: [1, 3, 1] }),
      makeTick(3, 7, { 10: [1, 5, 1] }),
      makeTick(4, 2, { 10: [0, 0, 1] }),
      makeTick(5, 6, { 10: [2, 1, 2], 20: [1, 4] }),
      makeTick(6, 3, { 10: [1, 0, 2], 20: [0, 0] }),
      makeTick(7, 8, { 10: [2, 2, 2], 20: [1, 1] }),
    ];

    const widths = [1, 2, 3, 7, 60, 1000];

    it("reports the same aggregate at every width", () => {
      const baseline = aggregate(series, testWorkCenters, 1);

      for (const width of widths) {
        expect(aggregate(series, testWorkCenters, width)).toEqual(baseline);
      }
    });

    it("keeps mean and peak WIP exact, which a closing level alone cannot", () => {
      // the first sketch of the bucket stored only WIP at bucket end; at width
      // 7 that is 8, and a mean of the ends would read 8 rather than 39/7
      for (const width of widths) {
        const result = aggregate(series, testWorkCenters, width);
        expect(result.meanWip).toBe(39 / 7);
        expect(result.maxWip).toBe(9);
        expect(result.finalWip).toBe(8);
      }
    });

    it("keeps the window bounds on the ticks, not on the grid", () => {
      // at width 60 the single bucket's slot is ticks 1..60, but only 1..7 were
      // observed, and the label has to say what was actually covered
      const result = aggregate(series, testWorkCenters, 60);
      expect(result.fromTick).toBe(1);
      expect(result.toTick).toBe(7);
      expect(result.tickCount).toBe(7);
    });

    it("keeps utilization and worst queue exact across a capacity change", () => {
      for (const width of widths) {
        const result = aggregate(series, testWorkCenters, width);
        // 8 busy machine-ticks over 1+1+1+1+2+2+2 = 10 capacity-ticks
        expect(at(result, 10)?.busyMachineTicks).toBe(8);
        expect(at(result, 10)?.capacityTicks).toBe(10);
        expect(at(result, 10)?.utilization).toBe(0.8);
        expect(at(result, 10)?.maxQueueDepth).toBe(5);
        // center 20 was observed for three ticks only, and divides by those
        expect(at(result, 20)?.observedTicks).toBe(3);
        expect(at(result, 20)?.meanQueueDepth).toBe(5 / 3);
      }
    });
  });
});

describe("aggregateCycleTime", () => {
  let nextId = 0;
  const finished = (releasedAtTick: number, completedAtTick: number): FinishedPart => ({
    id: `part-${++nextId}`,
    workOrderId: 1,
    releasedAtTick,
    completedAtTick,
  });

  it("measures a part from release to completion", () => {
    const result = aggregateCycleTime([finished(10, 34)]);

    expect(result.count).toBe(1);
    expect(result.meanSeconds).toBe(24);
    expect(result.minSeconds).toBe(24);
    expect(result.maxSeconds).toBe(24);
  });

  it("counts waiting, not just processing", () => {
    // both parts were released together; the second sat in a queue behind the
    // first and its cycle time says so
    const result = aggregateCycleTime([finished(0, 10), finished(0, 40)]);

    expect(result.minSeconds).toBe(10);
    expect(result.maxSeconds).toBe(40);
    expect(result.meanSeconds).toBe(25);
  });

  it("reports the tail the mean hides", () => {
    const result = aggregateCycleTime([
      finished(0, 2),
      finished(0, 4),
      finished(0, 6),
      finished(0, 8),
      finished(0, 100),
    ]);

    // one late part drags the mean four times past the typical part
    expect(result.meanSeconds).toBe(24);
    expect(result.medianSeconds).toBe(6);
    expect(result.p95Seconds).toBe(100);
  });

  it("takes percentiles by nearest rank, so every value is one a part had", () => {
    const parts = Array.from({ length: 20 }, (_, i) => finished(0, i + 1));
    const result = aggregateCycleTime(parts);

    expect(result.medianSeconds).toBe(10);
    expect(result.p95Seconds).toBe(19);
  });

  it("aggregates regardless of the order it is handed", () => {
    const result = aggregateCycleTime([finished(0, 9), finished(0, 3), finished(0, 6)]);

    expect(result.minSeconds).toBe(3);
    expect(result.medianSeconds).toBe(6);
    expect(result.maxSeconds).toBe(9);
  });

  it("allows a cycle time of zero", () => {
    // a part stranded by a shortened routing finishes on the tick it is seen
    const result = aggregateCycleTime([finished(7, 7)]);

    expect(result.count).toBe(1);
    expect(result.meanSeconds).toBe(0);
  });

  it("reports nulls, not zeroes, when nothing has finished", () => {
    expect(aggregateCycleTime([])).toEqual({
      count: 0,
      meanSeconds: null,
      minSeconds: null,
      maxSeconds: null,
      medianSeconds: null,
      p95Seconds: null,
    });
  });

  it("throws when a part finished before it was released", () => {
    expect(() => aggregateCycleTime([finished(30, 12)])).toThrow(
      /before it was released/,
    );
  });
});

describe("aggregateOnTimeDelivery", () => {
  const measured = (completedAtTick: number, dueAtTick: number | null) => ({
    completedAtTick,
    dueAtTick,
  });

  it("returns nulls, not zeroes, when nothing finished", () => {
    expect(aggregateOnTimeDelivery([])).toEqual({
      measuredCount: 0,
      onTimeCount: 0,
      lateCount: 0,
      onTimeFraction: null,
      meanLatenessSeconds: null,
      maxLatenessSeconds: null,
    });
  });

  it("measures nothing when no finished unit carried a promise", () => {
    // "no promises" is not "100% kept" - a window of uncovered or undated
    // units reads exactly like an empty one
    const result = aggregateOnTimeDelivery([
      measured(100, null),
      measured(200, null),
    ]);
    expect(result.measuredCount).toBe(0);
    expect(result.onTimeFraction).toBeNull();
  });

  it("counts a unit finishing exactly on the due tick as on time", () => {
    const result = aggregateOnTimeDelivery([measured(28800, 28800)]);
    expect(result.onTimeCount).toBe(1);
    expect(result.lateCount).toBe(0);
    expect(result.onTimeFraction).toBe(1);
  });

  it("counts one tick past the due tick as late, by one second", () => {
    const result = aggregateOnTimeDelivery([measured(28801, 28800)]);
    expect(result.lateCount).toBe(1);
    expect(result.onTimeFraction).toBe(0);
    expect(result.meanLatenessSeconds).toBe(1);
    expect(result.maxLatenessSeconds).toBe(1);
  });

  it("partitions a mixed window and averages lateness over late units only", () => {
    const result = aggregateOnTimeDelivery([
      measured(100, 200), // on time
      measured(300, 200), // 100 late
      measured(500, 200), // 300 late
      measured(999, null), // unmeasured
    ]);
    expect(result.measuredCount).toBe(3);
    expect(result.onTimeCount).toBe(1);
    expect(result.lateCount).toBe(2);
    expect(result.onTimeFraction).toBeCloseTo(1 / 3);
    expect(result.meanLatenessSeconds).toBe(200);
    expect(result.maxLatenessSeconds).toBe(300);
  });

  it("reports all-on-time as fraction 1 with null lateness, not zero", () => {
    // null keeps "every promise kept" distinguishable from "nothing promised"
    // on the lateness side too
    const result = aggregateOnTimeDelivery([
      measured(100, 200),
      measured(150, 200),
    ]);
    expect(result.onTimeFraction).toBe(1);
    expect(result.meanLatenessSeconds).toBeNull();
    expect(result.maxLatenessSeconds).toBeNull();
  });

  it("does not throw for a unit due before it could have started", () => {
    // legal, unlike a negative cycle time: an order can already be late when
    // its work order is released
    const result = aggregateOnTimeDelivery([measured(50, 10)]);
    expect(result.lateCount).toBe(1);
    expect(result.maxLatenessSeconds).toBe(40);
  });
});

describe("groupDeliveryBySalesOrder", () => {
  const sold = (
    salesOrderId: number | null,
    completedAtTick: number,
    dueAtTick: number | null,
  ) => ({ salesOrderId, completedAtTick, dueAtTick });

  it("returns nothing for an empty window", () => {
    expect(groupDeliveryBySalesOrder([])).toEqual([]);
  });

  it("excludes uncovered units, which belong to no order", () => {
    expect(groupDeliveryBySalesOrder([sold(null, 100, null)])).toEqual([]);
  });

  it("partitions finishes by order, sorted by order id", () => {
    const rows = groupDeliveryBySalesOrder([
      sold(21, 100, 200), // on time
      sold(20, 150, 100), // 50 late
      sold(21, 300, 200), // 100 late
    ]);

    expect(rows.map((r) => r.salesOrderId)).toEqual([20, 21]);
    expect(rows[0]?.delivery).toMatchObject({
      measuredCount: 1,
      lateCount: 1,
      maxLatenessSeconds: 50,
    });
    expect(rows[1]?.delivery).toMatchObject({
      measuredCount: 2,
      onTimeCount: 1,
      lateCount: 1,
      onTimeFraction: 0.5,
    });
  });

  it("sums per-order counts to the overall aggregate's", () => {
    // the rows and the card must agree by construction, like the tick total
    // and its per-part credits
    const parts = [
      sold(20, 100, 50),
      sold(21, 200, 300),
      sold(null, 250, null),
      sold(20, 400, 50),
      sold(22, 500, null), // covered, but the order never promised
    ];
    const overall = aggregateOnTimeDelivery(parts);
    const rows = groupDeliveryBySalesOrder(parts);

    const sum = (pick: (r: (typeof rows)[number]) => number) =>
      rows.reduce((total, row) => total + pick(row), 0);
    expect(sum((r) => r.delivery.measuredCount)).toBe(overall.measuredCount);
    expect(sum((r) => r.delivery.onTimeCount)).toBe(overall.onTimeCount);
    expect(sum((r) => r.delivery.lateCount)).toBe(overall.lateCount);
  });

  it("reports the due tick and finish of the latest unit, in finish order", () => {
    // units of one order can disagree about the due tick only via a mid-run
    // edit; the newest is what the order currently promises
    const rows = groupDeliveryBySalesOrder([
      sold(20, 100, 200),
      sold(20, 300, 250),
    ]);
    expect(rows[0]?.dueAtTick).toBe(250);
    expect(rows[0]?.lastCompletedAtTick).toBe(300);
  });

  it("counts every shipped unit, promised or not", () => {
    // an undated order measures nothing but still ships - finishedCount is the
    // group size, not measuredCount
    const rows = groupDeliveryBySalesOrder([
      sold(22, 100, null),
      sold(22, 200, null),
    ]);
    expect(rows[0]?.finishedCount).toBe(2);
    expect(rows[0]?.delivery.measuredCount).toBe(0);
  });
});

describe("aggregateScrap", () => {
  it("answers a clean window with zeroes, not nulls", () => {
    // unlike "no parts finished", zero scrap over observed ticks is a real
    // observation: the factory ran clean
    expect(aggregateScrap([])).toEqual({
      scrappedCount: 0,
      scrappedMaterialCents: 0,
    });
  });

  it("counts the window's ruined units and sums their frozen material", () => {
    expect(
      aggregateScrap([
        { materialCostCents: 1200 },
        { materialCostCents: 800 },
        { materialCostCents: 1200 },
      ]),
    ).toEqual({ scrappedCount: 3, scrappedMaterialCents: 3200 });
  });
});
