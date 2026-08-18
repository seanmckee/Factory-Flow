import { Router } from "express";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  allocations,
  parts,
  routings,
  salesOrders,
  workOrders,
} from "../db/schema.js";
import { parseOr400 } from "../lib/validate.js";
import {
  createWorkOrderSchema,
  forceQuerySchema,
  idParamSchema,
} from "../schemas/orders.js";
import { nextOrderNumber } from "../lib/orderNumber.js";
import {
  planAutoAllocation,
  planExplicitAllocation,
  type PlannedAllocation,
} from "../lib/allocate.js";
import { HttpError, isHttpError } from "../lib/httpError.js";

const router = Router();

type WorkOrderAllocation = {
  id: number;
  salesOrderId: number;
  salesOrderNumber: string;
  quantity: number;
};

/**
 * workOrderId -> its allocations, each carrying the sales order number so the UI
 * can show "SO-2001 (10)" without a second lookup. Ordered by allocation id to
 * match how throughput credits finished units.
 */
async function allocationsByWorkOrder(
  workOrderIds: number[],
): Promise<Map<number, WorkOrderAllocation[]>> {
  const grouped = new Map<number, WorkOrderAllocation[]>();
  // inArray([]) compiles to `false`, so this is safe on an empty table
  const rows = await db
    .select({
      id: allocations.id,
      workOrderId: allocations.workOrderId,
      salesOrderId: allocations.salesOrderId,
      quantity: allocations.quantity,
      salesOrderNumber: salesOrders.orderNumber,
    })
    .from(allocations)
    .innerJoin(salesOrders, eq(allocations.salesOrderId, salesOrders.id))
    .where(inArray(allocations.workOrderId, workOrderIds))
    .orderBy(allocations.id);

  for (const row of rows) {
    const list = grouped.get(row.workOrderId) ?? [];
    list.push({
      id: row.id,
      salesOrderId: row.salesOrderId,
      salesOrderNumber: row.salesOrderNumber,
      quantity: row.quantity,
    });
    grouped.set(row.workOrderId, list);
  }

  return grouped;
}

router.get("/", async (_req, res) => {
  try {
    const orders = await db
      .select({
        id: workOrders.id,
        orderNumber: workOrders.orderNumber,
        partId: workOrders.partId,
        routingId: workOrders.routingId,
        quantity: workOrders.quantity,
        status: workOrders.status,
        partNumber: parts.partNumber,
        partName: parts.name,
      })
      .from(workOrders)
      .innerJoin(parts, eq(workOrders.partId, parts.id))
      .orderBy(workOrders.id);

    const grouped = await allocationsByWorkOrder(orders.map((o) => o.id));

    res.json(
      orders.map((order) => ({
        ...order,
        allocations: grouped.get(order.id) ?? [],
      })),
    );
  } catch (error) {
    console.error("Error getting work orders", error);
    res.status(500).json({ message: "Error getting work orders" });
  }
});

router.post("/", async (req, res) => {
  try {
    const body = parseOr400(createWorkOrderSchema, req.body, res);
    if (!body) return;

    const { partId, routingId, quantity } = body;
    // exactOptionalPropertyTypes: normalise undefined to null rather than
    // carrying an optional key around
    const salesOrderId = body.salesOrderId ?? null;
    const allocationQuantity = body.allocationQuantity ?? null;

    const [part] = await db.select().from(parts).where(eq(parts.id, partId));
    if (!part) {
      return res.status(400).json({ message: "Part not found" });
    }

    const [routing] = await db
      .select()
      .from(routings)
      .where(eq(routings.id, routingId));
    if (!routing) {
      return res.status(400).json({ message: "Routing not found" });
    }
    // otherwise a part could be built on another part's routing, which would
    // quietly produce the wrong process times and throughput
    if (routing.partId !== partId) {
      return res
        .status(400)
        .json({ message: "Routing does not belong to the selected part" });
    }

    const created = await db.transaction(async (tx) => {
      const existing = await tx
        .select({ orderNumber: workOrders.orderNumber })
        .from(workOrders);

      const orderNumber = nextOrderNumber(
        existing.map((row) => row.orderNumber),
        "WO",
      );

      const [workOrder] = await tx
        .insert(workOrders)
        .values({ partId, routingId, quantity, orderNumber })
        .returning();

      if (!workOrder) throw new HttpError(500, "Work order insert failed");

      // read demand inside the transaction so the open quantities match what we write
      const partSalesOrders = await tx
        .select()
        .from(salesOrders)
        .where(eq(salesOrders.partId, partId))
        .orderBy(salesOrders.id);

      const existingAllocations = await tx
        .select()
        .from(allocations)
        .where(
          inArray(
            allocations.salesOrderId,
            partSalesOrders.map((so) => so.id),
          ),
        );

      const allocatedBySalesOrderId = new Map<number, number>();
      for (const allocation of existingAllocations) {
        allocatedBySalesOrderId.set(
          allocation.salesOrderId,
          (allocatedBySalesOrderId.get(allocation.salesOrderId) ?? 0) +
            allocation.quantity,
        );
      }

      let planned: PlannedAllocation[];
      if (salesOrderId !== null) {
        // looked up by id rather than within partSalesOrders, so a sales order
        // for the wrong part reports the mismatch instead of a bare 404
        const [target] = await tx
          .select()
          .from(salesOrders)
          .where(eq(salesOrders.id, salesOrderId));
        if (!target) throw new HttpError(404, "Sales order not found");

        planned = planExplicitAllocation(
          target,
          allocatedBySalesOrderId,
          partId,
          workOrder.id,
          quantity,
          allocationQuantity,
        );
      } else {
        planned = planAutoAllocation(
          partSalesOrders,
          allocatedBySalesOrderId,
          workOrder.id,
          quantity,
        );
      }

      // single insert, in oldest-sales-order-first order: allocation ids end up
      // ascending in that same order, which is the order throughput credits them
      if (planned.length > 0) {
        await tx.insert(allocations).values(planned);
      }

      return workOrder;
    });

    const grouped = await allocationsByWorkOrder([created.id]);

    res.status(201).json({
      ...created,
      partNumber: part.partNumber,
      partName: part.name,
      allocations: grouped.get(created.id) ?? [],
    });
  } catch (error) {
    if (isHttpError(error)) {
      return res.status(error.status).json({ message: error.message });
    }
    console.error("Error creating work order", error);
    res.status(500).json({ message: "Error creating work order" });
  }
});

/**
 * Deleting supply. Allocation rows cascade away (allocations.work_order_id is
 * ON DELETE CASCADE), which reopens the demand this order was filling - so it
 * needs confirming when anything is linked.
 */
router.delete("/:id", async (req, res) => {
  try {
    const params = parseOr400(idParamSchema, req.params, res);
    if (!params) return;
    const query = parseOr400(forceQuerySchema, req.query, res);
    if (!query) return;
    const force = query.force === "true";

    const [workOrder] = await db
      .select()
      .from(workOrders)
      .where(eq(workOrders.id, params.id));
    if (!workOrder) {
      return res.status(404).json({ message: "Work order not found" });
    }

    // read before deleting - the cascade removes these rows
    const linked = (await allocationsByWorkOrder([params.id])).get(params.id) ?? [];

    if (linked.length > 0 && !force) {
      const total = linked.reduce((sum, link) => sum + link.quantity, 0);
      return res.status(409).json({
        message: `${workOrder.orderNumber} has ${total} allocated units`,
        requiresConfirmation: true,
        allocations: linked.map((link) => ({
          orderNumber: link.salesOrderNumber,
          quantity: link.quantity,
        })),
      });
    }

    await db.delete(workOrders).where(eq(workOrders.id, params.id));

    res.json({
      orderNumber: workOrder.orderNumber,
      deletedAllocations: linked.length,
    });
  } catch (error) {
    console.error("Error deleting work order", error);
    res.status(500).json({ message: "Error deleting work order" });
  }
});

export default router;
