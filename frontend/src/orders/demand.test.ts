import { describe, it, expect } from "vitest";
import { summarizeDemand, totalOpenDemand } from "./demand";
import type { SalesOrder } from "../types/SalesOrder";
import type { WorkOrder } from "../types/WorkOrder";

const salesOrder = (
  id: number,
  partId: number,
  quantity: number,
  allocated: number,
): SalesOrder => ({
  id,
  partId,
  quantity,
  unitPriceCents: 5000,
  orderNumber: `SO-${2000 + id}`,
  allocations: allocated
    ? [{ id, salesOrderId: id, workOrderId: 99, quantity: allocated }]
    : [],
});

const workOrder = (
  id: number,
  partId: number,
  quantity: number,
  allocated: number,
): WorkOrder => ({
  id,
  orderNumber: `WO-${1000 + id}`,
  partId,
  routingId: 1,
  quantity,
  status: "pending",
  partNumber: "100-001",
  partName: "Bracket",
  allocations: allocated
    ? [
        {
          id,
          salesOrderId: 1,
          salesOrderNumber: "SO-2001",
          quantity: allocated,
        },
      ]
    : [],
});

describe("summarizeDemand", () => {
  it("counts only the unfilled part of a sales order", () => {
    const [entry] = summarizeDemand([salesOrder(1, 7, 12, 10)], []);
    expect(entry.openDemandUnits).toBe(2);
    expect(entry.netToMakeUnits).toBe(2);
  });

  it("omits parts whose demand is fully allocated", () => {
    expect(summarizeDemand([salesOrder(1, 7, 12, 12)], [])).toEqual([]);
  });

  it("sums several open orders for one part and lists them", () => {
    const [entry] = summarizeDemand(
      [salesOrder(1, 7, 10, 0), salesOrder(2, 7, 5, 1)],
      [],
    );
    expect(entry.openDemandUnits).toBe(14);
    expect(entry.openOrders.map((o) => o.orderNumber)).toEqual([
      "SO-2001",
      "SO-2002",
    ]);
  });

  it("nets off unallocated work order units as uncommitted supply", () => {
    // 10 open demand, a work order of 8 with only 3 allocated -> 5 spare
    const [entry] = summarizeDemand(
      [salesOrder(1, 7, 10, 0)],
      [workOrder(1, 7, 8, 3)],
    );
    expect(entry.openDemandUnits).toBe(10);
    expect(entry.uncommittedSupplyUnits).toBe(5);
    expect(entry.netToMakeUnits).toBe(5);
  });

  it("floors net at zero when spare supply exceeds demand", () => {
    const [entry] = summarizeDemand(
      [salesOrder(1, 7, 3, 0)],
      [workOrder(1, 7, 20, 0)],
    );
    expect(entry.netToMakeUnits).toBe(0);
    // still surfaced, so the spare inventory is visible
    expect(entry.openDemandUnits).toBe(3);
  });

  it("keeps parts separate and sorts by net to make", () => {
    const summaries = summarizeDemand(
      [salesOrder(1, 7, 2, 0), salesOrder(2, 8, 30, 0)],
      [],
    );
    expect(summaries.map((s) => s.partId)).toEqual([8, 7]);
  });

  it("ignores work orders for parts with no open demand", () => {
    expect(summarizeDemand([], [workOrder(1, 7, 10, 0)])).toEqual([]);
  });

  it("totals open demand across parts", () => {
    const summaries = summarizeDemand(
      [salesOrder(1, 7, 10, 0), salesOrder(2, 8, 4, 1)],
      [],
    );
    expect(totalOpenDemand(summaries)).toBe(13);
  });
});
