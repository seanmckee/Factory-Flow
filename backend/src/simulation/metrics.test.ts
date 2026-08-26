import { describe, it, expect } from "vitest";
import { aggregateMetrics } from "./metrics.js";
import { simulateTick } from "./simulationTick.js";
import type { TickMetrics } from "./simulationTick.js";
import type { Routing, WipPart, WorkCenter } from "./types.js";

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
        routingId: 1,
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
