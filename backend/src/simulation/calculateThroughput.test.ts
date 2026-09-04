import { describe, it, expect } from "vitest";
import {
  calculateThroughput,
  creditFinishedParts,
} from "./calculateThroughput.js";
import type { Allocation, FinishedPart } from "./types.js";

const parts = [{ id: 1, materialCostCents: 1200 }];

const workOrders = [{ id: 10, partId: 1 }];

// SO-20 promises day 1; SO-21 made no promise, so its units are never measured
const salesOrders = [
  { id: 20, unitPriceCents: 5000, dueAtTick: 28800 },
  { id: 21, unitPriceCents: 5500, dueAtTick: null },
];

// SO-20 takes the first two units of the work order, SO-21 the next three
const allocations: Allocation[] = [
  { id: 1, salesOrderId: 20, workOrderId: 10, quantity: 2 },
  { id: 2, salesOrderId: 21, workOrderId: 10, quantity: 3 },
];

let nextPartId = 0;
const finished = (workOrderId: number): FinishedPart => ({
  id: `part-${++nextPartId}`,
  workOrderId,
  releasedAtTick: 0,
  completedAtTick: 1,
});

/** how many units of work order 10 finished before this tick */
const priorCounts = (count: number) => new Map([[10, count]]);

const throughput = (
  justFinished: FinishedPart[],
  prior = new Map<number, number>(),
  allocs = allocations,
) =>
  calculateThroughput(
    justFinished,
    prior,
    workOrders,
    parts,
    salesOrders,
    allocs,
  );

describe("calculateThroughput", () => {
  it("prices the first unit against the first allocation", () => {
    expect(throughput([finished(10)])).toBe(3800); // 5000 - 1200
  });

  it("prices the third unit against the second allocation", () => {
    expect(throughput([finished(10)], priorCounts(2))).toBe(4300); // 5500 - 1200
  });

  it("values unallocated units at zero", () => {
    expect(throughput([finished(10)], priorCounts(5))).toBe(0);
  });

  it("earns nothing when the work order was never sold", () => {
    expect(throughput([finished(10)], new Map(), [])).toBe(0);
  });

  it("counts units finishing in the same tick against successive allocations", () => {
    // units 0 and 1 at 5000, unit 2 at 5500, all in one tick
    const result = throughput([finished(10), finished(10), finished(10)]);
    expect(result).toBe(3800 + 3800 + 4300);
  });

  it("carries the prior count into units finishing in the same tick", () => {
    // unit 1 at 5000, units 2 and 3 at 5500
    const result = throughput(
      [finished(10), finished(10), finished(10)],
      priorCounts(1),
    );
    expect(result).toBe(3800 + 4300 + 4300);
  });

  it("stops earning partway through a tick when the allocations run out", () => {
    // units 3 and 4 are the last sold; the fifth is inventory
    const result = throughput(
      [finished(10), finished(10), finished(10)],
      priorCounts(3),
    );
    expect(result).toBe(4300 + 4300);
  });

  it("credits allocations in id order, not the order they are given in", () => {
    const reversed = [...allocations].reverse();
    expect(throughput([finished(10)], new Map(), reversed)).toBe(3800);
  });

  it("ignores allocations belonging to another work order", () => {
    const otherWorkOrder: Allocation = {
      id: 0,
      salesOrderId: 21,
      workOrderId: 11,
      quantity: 99,
    };
    expect(throughput([finished(10)], new Map(), [otherWorkOrder, ...allocations])).toBe(
      3800,
    );
  });

  it("earns nothing when nothing finished", () => {
    expect(throughput([])).toBe(0);
  });

  it("throws when a finished part's work order was not loaded", () => {
    expect(() => throughput([finished(99)])).toThrow(/work order 99/);
  });

  it("throws when the work order's part was not loaded", () => {
    expect(() =>
      calculateThroughput(
        [finished(10)],
        new Map(),
        workOrders,
        [],
        salesOrders,
        allocations,
      ),
    ).toThrow(/part 1/);
  });

  it("throws when an allocation's sales order was not loaded", () => {
    expect(() =>
      calculateThroughput(
        [finished(10)],
        new Map(),
        workOrders,
        parts,
        [],
        allocations,
      ),
    ).toThrow(/sales order 20/);
  });

  it("does not throw for a sales order that is missing beyond the units that finished", () => {
    // only the first allocation is reached, so SO-21's absence is never touched
    expect(
      calculateThroughput(
        [finished(10)],
        new Map(),
        workOrders,
        parts,
        [{ id: 20, unitPriceCents: 5000, dueAtTick: 28800 }],
        allocations,
      ),
    ).toBe(3800);
  });
});

describe("creditFinishedParts", () => {
  const credit = (
    justFinished: FinishedPart[],
    prior = new Map<number, number>(),
    allocs = allocations,
  ) =>
    creditFinishedParts(
      justFinished,
      prior,
      workOrders,
      parts,
      salesOrders,
      allocs,
    );

  it("records the sales order and price a covered unit was sold at", () => {
    const part = finished(10);
    expect(credit([part])).toEqual([
      {
        partId: part.id,
        workOrderId: 10,
        throughputCents: 3800,
        salesOrderId: 20,
        unitPriceCents: 5000,
        materialCostCents: 1200,
        dueAtTick: 28800,
      },
    ]);
  });

  it("nulls the sales order and price of an uncovered unit, keeping its cost", () => {
    // built beyond what anybody bought: earns nothing, but the material was
    // still spent, and Track 6's carrying cost is priced off it
    const part = finished(10);
    expect(credit([part], priorCounts(5))).toEqual([
      {
        partId: part.id,
        workOrderId: 10,
        throughputCents: 0,
        salesOrderId: null,
        unitPriceCents: null,
        materialCostCents: 1200,
        dueAtTick: null,
      },
    ]);
  });

  it("attributes units finishing in one tick to successive sales orders", () => {
    // units 1 and 2 of the work order straddle the allocation boundary, so the
    // two parts sold at different prices in the same tick — which is why the
    // money is frozen per part rather than divided out of a tick total
    const first = finished(10);
    const second = finished(10);

    const credits = credit([first, second], priorCounts(1));

    expect(credits.map((c) => c.partId)).toEqual([first.id, second.id]);
    expect(credits.map((c) => c.salesOrderId)).toEqual([20, 21]);
    expect(credits.map((c) => c.unitPriceCents)).toEqual([5000, 5500]);
    expect(credits.map((c) => c.throughputCents)).toEqual([3800, 4300]);
    // the due tick follows the covering order exactly as the price does
    expect(credits.map((c) => c.dueAtTick)).toEqual([28800, null]);
  });

  it("nulls the due tick of a covered unit whose order made no promise", () => {
    // unlike unitPriceCents, dueAtTick is NOT null exactly when salesOrderId
    // is — a covered unit of an undated order keeps its price and stays
    // unmeasured for on-time delivery
    const [c] = credit([finished(10)], priorCounts(2));
    expect(c?.salesOrderId).toBe(21);
    expect(c?.unitPriceCents).toBe(5500);
    expect(c?.dueAtTick).toBeNull();
  });

  it("returns one credit per finished part, in finish order", () => {
    const someFinished = [finished(10), finished(10), finished(10)];
    expect(credit(someFinished).map((c) => c.partId)).toEqual(
      someFinished.map((p) => p.id),
    );
  });

  it("sums to the tick total the chart reads", () => {
    const someFinished = [finished(10), finished(10)];
    const total = credit(someFinished, priorCounts(1)).reduce(
      (sum, c) => sum + c.throughputCents,
      0,
    );
    expect(total).toBe(
      calculateThroughput(
        someFinished,
        priorCounts(1),
        workOrders,
        parts,
        salesOrders,
        allocations,
      ),
    );
  });
});
