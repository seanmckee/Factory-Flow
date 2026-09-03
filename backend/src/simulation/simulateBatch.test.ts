import { describe, it, expect } from "vitest";
import { simulateBatch, type RunState } from "./simulateBatch.js";
import type { Routing, WipPart, WorkCenter } from "./types.js";

const SEED = 42;

/** one operation at center 10, so a part finishes every 5 ticks or so */
const oneStep: Routing = {
  steps: [{ workCenterId: 10, processTimeSeconds: 5 }],
};

const workCenters = new Map<number, WorkCenter>([
  [10, { id: 10, capacity: 1 }],
  [20, { id: 20, capacity: 1 }],
]);

const part = (id: string, overrides: Partial<WipPart> = {}): WipPart => ({
  id,
  workOrderId: 10,
  releasedAtTick: 0,
  stepIndex: 0,
  progressSeconds: 0,
  actualProcessTimeSeconds: 5,
  ...overrides,
});

const state = (overrides: Partial<RunState> = {}): RunState => ({
  tickNum: 0,
  rngSeed: SEED,
  wipParts: [],
  routingByWorkOrder: new Map([[10, oneStep]]),
  workCenters,
  workOrders: [{ id: 10, partId: 1 }],
  parts: [{ id: 1, materialCostCents: 1200 }],
  salesOrders: [
    { id: 20, unitPriceCents: 5000 },
    { id: 21, unitPriceCents: 5500 },
  ],
  // SO-20 takes the first unit of the work order, SO-21 the next
  allocations: [
    { id: 1, salesOrderId: 20, workOrderId: 10, quantity: 1 },
    { id: 2, salesOrderId: 21, workOrderId: 10, quantity: 1 },
  ],
  priorCounts: new Map(),
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
    });
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
