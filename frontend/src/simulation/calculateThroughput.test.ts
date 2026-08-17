import { describe, it, expect } from "vitest";
import { calculateThroughput } from "./calculateThroughput";

const parts = [
  { id: 1, partNumber: "100-001", name: "Bracket", materialCostCents: 1200 },
];

const workOrders = [
  {
    id: 10,
    partId: 1,
    routingId: 100,
    quantity: 5,
    orderNumber: "WO-1003",
    partName: "Bracket",
  },
];

const salesOrders = [
  {
    id: 20,
    partId: 1,
    quantity: 2,
    unitPriceCents: 5000,
    orderNumber: "SO-2001",
    allocations: [{ id: 1, salesOrderId: 20, workOrderId: 10, quantity: 2 }],
  },
  {
    id: 21,
    partId: 1,
    quantity: 3,
    unitPriceCents: 5500,
    orderNumber: "SO-2002",
    allocations: [{ id: 2, salesOrderId: 21, workOrderId: 10, quantity: 3 }],
  },
];

const makePart = (workOrderId: number) => ({
  id: crypto.randomUUID(),
  workOrderId,
  routingId: 100,
  stepIndex: -1,
  progressSeconds: 0,
  actualProcessTimeSeconds: 5,
});

describe("calculateThroughput", () => {
  it("prices the first unit against the first allocation", () => {
    const result = calculateThroughput(
      [makePart(10)],
      [],
      workOrders,
      parts,
      salesOrders,
    );
    expect(result).toBe(3800); // 5000 - 1200
  });

  it("prices the third unit against the second allocation", () => {
    const prior = [makePart(10), makePart(10)];
    const result = calculateThroughput(
      [makePart(10)],
      prior,
      workOrders,
      parts,
      salesOrders,
    );
    expect(result).toBe(4300); // 5500 - 1200
  });

  it("values unallocated units at zero", () => {
    const prior = Array.from({ length: 5 }, () => makePart(10));
    const result = calculateThroughput(
      [makePart(10)],
      prior,
      workOrders,
      parts,
      salesOrders,
    );
    expect(result).toBe(0);
  });
});
