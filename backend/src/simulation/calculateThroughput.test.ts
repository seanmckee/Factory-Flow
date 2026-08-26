import { describe, it, expect } from "vitest";
import { calculateThroughput } from "./calculateThroughput.js";
import type { Allocation, FinishedPart } from "./types.js";

const parts = [{ id: 1, materialCostCents: 1200 }];

const workOrders = [{ id: 10, partId: 1 }];

const salesOrders = [
  { id: 20, unitPriceCents: 5000 },
  { id: 21, unitPriceCents: 5500 },
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
        [{ id: 20, unitPriceCents: 5000 }],
        allocations,
      ),
    ).toBe(3800);
  });
});
