import { describe, it, expect } from "vitest";
import { aggregateCycleTime, aggregateMetrics } from "./metrics.js";
import { simulateTick } from "./simulationTick.js";
import type { TickMetrics } from "./simulationTick.js";
import type { FinishedPart, Routing, WipPart, WorkCenter } from "./types.js";

const makeWorkCenters = (...centers: [id: number, capacity: number][]) =>
  new Map<number, WorkCenter>(
    centers.map(([id, capacity]) => [id, { id, capacity }]),
  );

const testWorkCenters = makeWorkCenters([10, 1], [20, 1]);

/** One tick's observations. `at` is `[busy, queued]` per work center. */
const makeTick = (
  tickNum: number,
  wipCount: number,
  at: Record<number, [busy: number, queued: number]>,
): TickMetrics => ({
  tickNum,
  wipCount,
  workCenters: Object.entries(at).map(([id, [busy, queued]]) => ({
    workCenterId: Number(id),
    busy,
    queued,
  })),
});

const at = (result: ReturnType<typeof aggregateMetrics>, workCenterId: number) =>
  result.workCenters.find((wc) => wc.workCenterId === workCenterId);

describe("aggregateMetrics", () => {
  it("divides busy machine-ticks by capacity times ticks", () => {
    const centers = makeWorkCenters([10, 2]);
    const result = aggregateMetrics(
      [
        makeTick(1, 3, { 10: [2, 1] }),
        makeTick(2, 3, { 10: [2, 1] }),
        makeTick(3, 2, { 10: [1, 0] }),
        makeTick(4, 0, { 10: [0, 0] }),
      ],
      centers,
    );

    // 5 machine-ticks worked out of 2 machines x 4 ticks
    expect(at(result, 10)?.busyMachineTicks).toBe(5);
    expect(at(result, 10)?.utilization).toBe(5 / 8);
  });

  it("reports a saturated center as fully utilized", () => {
    const result = aggregateMetrics(
      [makeTick(1, 1, { 10: [1, 0] }), makeTick(2, 1, { 10: [1, 0] })],
      makeWorkCenters([10, 1]),
    );

    expect(at(result, 10)?.utilization).toBe(1);
  });

  it("gives a fraction an instantaneous snapshot cannot", () => {
    // the whole point of a window: busy on 1 of 3 ticks is 0.33, not 0 or 1
    const result = aggregateMetrics(
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
    const result = aggregateMetrics(
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
    const result = aggregateMetrics(
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
    const result = aggregateMetrics(
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
    const result = aggregateMetrics(
      [makeTick(1, 1, { 10: [1, 0] })],
      testWorkCenters,
    );

    expect(at(result, 20)).toEqual({
      workCenterId: 20,
      utilization: 0,
      busyMachineTicks: 0,
      meanQueueDepth: 0,
      maxQueueDepth: 0,
      observedTicks: 0,
    });
  });

  it("divides by the ticks a center was observed, not the whole window", () => {
    // work center 20 was created halfway through the run; it was not idle
    // before that, it did not exist
    const result = aggregateMetrics(
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
    const result = aggregateMetrics([], testWorkCenters);

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
          meanQueueDepth: 0,
          maxQueueDepth: 0,
          observedTicks: 0,
        },
        {
          workCenterId: 20,
          utilization: 0,
          busyMachineTicks: 0,
          meanQueueDepth: 0,
          maxQueueDepth: 0,
          observedTicks: 0,
        },
      ],
    });
  });

  it("throws when a tick reports a work center that was not loaded", () => {
    expect(() =>
      aggregateMetrics(
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
            { workCenterId: 10, processTimeSeconds: 5 },
            { workCenterId: 20, processTimeSeconds: 5 },
          ],
        },
      ],
    ]);
    let wipParts: WipPart[] = [
      {
        id: "part-1",
        workOrderId: 1,
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

    const result = aggregateMetrics(series, testWorkCenters);

    expect(result.tickCount).toBe(3);
    // the part held work center 10 for all three ticks, then moved on
    expect(at(result, 10)?.utilization).toBe(1);
    expect(at(result, 20)?.utilization).toBe(0);
    expect(result.meanWip).toBe(1);
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
