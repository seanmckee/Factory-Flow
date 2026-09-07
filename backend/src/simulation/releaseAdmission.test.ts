import { describe, expect, it } from "vitest";
import type { CostRates } from "./operatingExpense.js";
import {
  admitOrderIntoState,
  buildReleaseParts,
  type AdmittableOrder,
} from "./releaseAdmission.js";
import {
  PROCESS_TIME_DEVIATION,
  sampleProcessTime,
} from "./sampleProcessTime.js";
import { simulateBatch, type RunState } from "./simulateBatch.js";
import type { Routing, WorkCenter } from "./types.js";

const SEED = 42;

const oneStep: Routing = {
  steps: [
    { workCenterId: 10, processTimeSeconds: 5, setupTimeSeconds: 0, scrapBps: 0 },
  ],
};

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
  workCenters: new Map<number, WorkCenter>([[10, { id: 10, capacity: 1 }]]),
  workOrders: [{ id: 10, partId: 1 }],
  parts: [{ id: 1, materialCostCents: 1200 }],
  salesOrders: [{ id: 20, unitPriceCents: 5000, dueAtTick: 10 }],
  allocations: [{ id: 1, salesOrderId: 20, workOrderId: 10, quantity: 1 }],
  priorCounts: new Map(),
  costs: freeCosts,
  carryRemainder: 0,
  setupDone: new Set<string>(),
  ...overrides,
});

/** work order 30 makes part 2, promised to sales order 40 */
const admittable = (overrides: Partial<AdmittableOrder> = {}): AdmittableOrder => ({
  workOrderId: 30,
  steps: oneStep.steps,
  workOrder: { id: 30, partId: 2 },
  part: { id: 2, materialCostCents: 700 },
  salesOrders: [{ id: 40, unitPriceCents: 3000, dueAtTick: 20 }],
  allocations: [{ id: 5, salesOrderId: 40, workOrderId: 30, quantity: 2 }],
  ...overrides,
});

describe("buildReleaseParts", () => {
  it("draws exactly what the manual release draws for the same key", () => {
    const parts = buildReleaseParts(
      { rngSeed: SEED, tickNum: 100 },
      30,
      3,
      5,
    );
    expect(parts).toHaveLength(3);
    parts.forEach((part, unitIndex) => {
      expect(part.unitIndex).toBe(unitIndex);
      expect(part.releasedAtTick).toBe(100);
      expect(part.stepIndex).toBe(0);
      expect(part.progressSeconds).toBe(0);
      expect(part.actualProcessTimeSeconds).toBe(
        sampleProcessTime(5, PROCESS_TIME_DEVIATION, {
          seed: SEED,
          workOrderId: 30,
          unitIndex,
          stepIndex: 0,
        }),
      );
    });
  });

  it("mints a distinct row identity per part", () => {
    const parts = buildReleaseParts({ rngSeed: SEED, tickNum: 0 }, 30, 4, 5);
    expect(new Set(parts.map((part) => part.id)).size).toBe(4);
  });
});

describe("admitOrderIntoState", () => {
  it("extends every map the engine throws on, so an admitted part can tick", () => {
    const order = admittable();
    const parts = buildReleaseParts({ rngSeed: SEED, tickNum: 0 }, 30, 2, 5);
    const admitted = admitOrderIntoState(state(), order, parts);

    // ticking to completion exercises the pinned-routing, material-cost and
    // credit lookups — a missed map extension throws here
    const batch = simulateBatch(admitted, 30);
    const finished = batch.finishedParts.filter((p) => p.workOrderId === 30);
    expect(finished).toHaveLength(2);
    // covered unit: 3000 - 700; both units covered by the quantity-2 allocation
    expect(finished.map((p) => p.throughputCents)).toEqual([2300, 2300]);
  });

  it("does not mutate the state it was given", () => {
    const before = state();
    const wipBefore = before.wipParts;
    admitOrderIntoState(
      before,
      admittable(),
      buildReleaseParts({ rngSeed: SEED, tickNum: 0 }, 30, 1, 5),
    );
    expect(before.wipParts).toBe(wipBefore);
    expect(before.routingByWorkOrder.has(30)).toBe(false);
    expect(before.workOrders).toHaveLength(1);
  });

  it("queues admitted parts behind the survivors under contention", () => {
    // one machine at wc 10; the existing part is listed first and admission
    // is list order, so the newcomer waits
    const existing = {
      id: "survivor",
      workOrderId: 10,
      unitIndex: 0,
      releasedAtTick: 0,
      stepIndex: 0,
      progressSeconds: 0,
      actualProcessTimeSeconds: 5,
    };
    const admitted = admitOrderIntoState(
      state({ wipParts: [existing] }),
      admittable(),
      buildReleaseParts({ rngSeed: SEED, tickNum: 0 }, 30, 1, 5),
    );
    const batch = simulateBatch(admitted, 1);
    const survivor = batch.wipParts.find((p) => p.id === "survivor");
    const newcomer = batch.wipParts.find((p) => p.workOrderId === 30);
    expect(survivor?.progressSeconds).toBe(1);
    expect(newcomer?.progressSeconds).toBe(0);
  });

  it("admits the same run whether the later advance is one batch or several", () => {
    // the advanceRun idiom: thread the batch outputs, admit between batches
    const thread = (base: RunState, batch: ReturnType<typeof simulateBatch>): RunState => ({
      ...base,
      tickNum: batch.tickNum,
      wipParts: batch.wipParts,
      priorCounts: batch.priorCounts,
      carryRemainder: batch.carryRemainder,
      setupDone: batch.setupDone,
    });
    const admitAt = (base: RunState): RunState =>
      admitOrderIntoState(
        base,
        admittable(),
        buildReleaseParts({ rngSeed: SEED, tickNum: base.tickNum }, 30, 2, 5),
      );

    // path A: 10 ticks, admit, 20 ticks in one batch
    const a0 = state();
    const aAdmitted = admitAt(thread(a0, simulateBatch(a0, 10)));
    const aFinal = simulateBatch(aAdmitted, 20);

    // path B: identical admission, the 20 ticks split 7 + 13
    const b0 = state();
    const bAdmitted = admitAt(thread(b0, simulateBatch(b0, 10)));
    const bMid = simulateBatch(bAdmitted, 7);
    const bFinal = simulateBatch(thread(bAdmitted, bMid), 13);

    const finishedOf = (records: { workOrderId: number; completedAtTick: number; throughputCents: number }[]) =>
      records.map((r) => [r.workOrderId, r.completedAtTick, r.throughputCents]);
    expect(
      finishedOf([...bMid.finishedParts, ...bFinal.finishedParts]),
    ).toEqual(finishedOf(aFinal.finishedParts));
    expect(bFinal.wipParts.map((p) => p.id)).toEqual(
      aFinal.wipParts.map((p) => p.id),
    );
    expect(bFinal.tickNum).toBe(aFinal.tickNum);
  });

  it("dedupes a part and a sales order the state already holds", () => {
    // work order 30 makes the SAME part as work order 10 and is covered by
    // the SAME sales order the state already knows
    const order = admittable({
      workOrder: { id: 30, partId: 1 },
      part: { id: 1, materialCostCents: 1200 },
      salesOrders: [{ id: 20, unitPriceCents: 5000, dueAtTick: 10 }],
      allocations: [{ id: 6, salesOrderId: 20, workOrderId: 30, quantity: 1 }],
    });
    const admitted = admitOrderIntoState(
      state(),
      order,
      buildReleaseParts({ rngSeed: SEED, tickNum: 0 }, 30, 1, 5),
    );
    expect(admitted.parts).toHaveLength(1);
    expect(admitted.salesOrders).toHaveLength(1);
    expect(admitted.allocations).toHaveLength(2);
    expect(admitted.workOrders).toHaveLength(2);
  });
});
