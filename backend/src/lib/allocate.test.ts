import { describe, it, expect } from "vitest";
import {
  openQuantity,
  planAutoAllocation,
  planExplicitAllocation,
  type AllocatableSalesOrder,
} from "./allocate.js";
import { isHttpError } from "./httpError.js";

const salesOrder = (
  id: number,
  quantity: number,
  partId = 1,
): AllocatableSalesOrder => ({
  id,
  partId,
  quantity,
  orderNumber: `SO-${String(id).padStart(4, "0")}`,
});

describe("openQuantity", () => {
  it("is the full quantity when nothing is allocated", () => {
    expect(openQuantity(salesOrder(1, 10), new Map())).toBe(10);
  });

  it("subtracts what is already allocated", () => {
    expect(openQuantity(salesOrder(1, 10), new Map([[1, 4]]))).toBe(6);
  });
});

describe("planAutoAllocation", () => {
  it("fills oldest demand first, spanning sales orders", () => {
    const rows = planAutoAllocation(
      [salesOrder(1, 5), salesOrder(2, 5)],
      new Map(),
      99,
      8,
    );

    // order matters: calculateThroughput credits units in allocation-id order,
    // and the caller inserts these rows in one statement
    expect(rows).toEqual([
      { salesOrderId: 1, workOrderId: 99, quantity: 5 },
      { salesOrderId: 2, workOrderId: 99, quantity: 3 },
    ]);
  });

  it("skips sales orders that are already full", () => {
    const rows = planAutoAllocation(
      [salesOrder(1, 5), salesOrder(2, 5)],
      new Map([[1, 5]]),
      99,
      2,
    );

    expect(rows).toEqual([{ salesOrderId: 2, workOrderId: 99, quantity: 2 }]);
  });

  it("leaves a remainder as inventory rather than erroring", () => {
    const rows = planAutoAllocation([salesOrder(1, 3)], new Map(), 99, 10);

    expect(rows).toEqual([{ salesOrderId: 1, workOrderId: 99, quantity: 3 }]);
  });
});

describe("planExplicitAllocation", () => {
  it("defaults to as much as the sales order can absorb", () => {
    const rows = planExplicitAllocation(
      salesOrder(1, 4),
      new Map(),
      1,
      99,
      10,
      null,
    );

    expect(rows).toEqual([{ salesOrderId: 1, workOrderId: 99, quantity: 4 }]);
  });

  it("rejects a sales order for a different part", () => {
    expect(() =>
      planExplicitAllocation(salesOrder(1, 5, 2), new Map(), 1, 99, 5, null),
    ).toThrowError(/different part/);
  });

  it("rejects rather than clamping an over-allocation", () => {
    expect(() =>
      planExplicitAllocation(salesOrder(1, 5), new Map(), 1, 99, 10, 7),
    ).toThrowError(/only 5 unfilled/);
  });

  it("throws an HttpError carrying a 400", () => {
    try {
      planExplicitAllocation(salesOrder(1, 5), new Map([[1, 5]]), 1, 99, 5, null);
      expect.unreachable("expected a fully-allocated sales order to throw");
    } catch (error) {
      // also proves the ESM ".js" specifier resolves under vitest
      expect(isHttpError(error)).toBe(true);
      if (isHttpError(error)) expect(error.status).toBe(400);
    }
  });
});
