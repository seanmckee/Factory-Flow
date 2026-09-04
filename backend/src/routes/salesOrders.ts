import { Router } from "express";
import { db } from "../db/index.js";
import { allocations, parts, salesOrders, workOrders } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { parseOr400 } from "../lib/validate.js";
import {
  createSalesOrderSchema,
  forceQuerySchema,
  idParamSchema,
} from "../schemas/orders.js";
import { nextOrderNumber } from "../lib/orderNumber.js";

const router = Router();

// put an allocations array onto each matching sales order
router.get("/", async (_req, res) => {
  try {
    const soData = await db.select().from(salesOrders).orderBy(salesOrders.id);
    // allocations are consumed in id order when crediting throughput, so the
    // query has to be deterministic rather than relying on heap order
    const allocationData = await db
      .select()
      .from(allocations)
      .orderBy(allocations.id);

    // id, allocations
    const orders = new Map<number, typeof allocationData>()
    for(const a of allocationData){
      const list = orders.get(a.salesOrderId) ?? []
      list.push(a);
      orders.set(a.salesOrderId, list);
    }
    const result = soData.map((s) => ({
      ...s,
      allocations: orders.get(s.id) ?? []
    }))

    res.json(result);
  } catch (error) {
    console.error("Error getting sales orders", error);
    res.status(500).json({ message: "Failed to get Sales Orders" });
  }
});

// Sales orders record demand only - they never create a work order.
router.post("/", async (req, res) => {
  try {
    const body = parseOr400(createSalesOrderSchema, req.body, res);
    if (!body) return;

    const { partId, quantity, unitPriceCents, dueDay } = body;

    const [part] = await db.select().from(parts).where(eq(parts.id, partId));
    if (!part) {
      return res.status(400).json({ message: "Part not found" });
    }

    // Not race-free: READ COMMITTED lets two concurrent creates read the same
    // max, and the second fails the unique constraint on order_number. Fine for a
    // single-user simulator - see nextOrderNumber.
    const created = await db.transaction(async (tx) => {
      const existing = await tx
        .select({ orderNumber: salesOrders.orderNumber })
        .from(salesOrders);

      const orderNumber = nextOrderNumber(
        existing.map((row) => row.orderNumber),
        "SO",
      );

      const [inserted] = await tx
        .insert(salesOrders)
        .values({ partId, quantity, unitPriceCents, orderNumber, dueDay: dueDay ?? null })
        .returning();

      return inserted;
    });

    if (!created) {
      return res.status(500).json({ message: "Sales order insert failed" });
    }

    // same shape as GET / so the client can treat both responses identically
    res.status(201).json({ ...created, allocations: [] });
  } catch (error) {
    console.error("Error creating sales order", error);
    res.status(500).json({ message: "Error creating sales order" });
  }
});

/**
 * Deleting demand. Allocation rows cascade away (allocations.sales_order_id is
 * ON DELETE CASCADE), which frees the units of any work order that was covering
 * this order back to inventory - so it needs confirming when anything is linked.
 *
 * Order numbers are max-suffix + 1, so deleting the newest order means the next
 * create reuses its number. Fine for a simulator.
 */
router.delete("/:id", async (req, res) => {
  try {
    const params = parseOr400(idParamSchema, req.params, res);
    if (!params) return;
    const query = parseOr400(forceQuerySchema, req.query, res);
    if (!query) return;
    const force = query.force === "true";

    const [salesOrder] = await db
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.id, params.id));
    if (!salesOrder) {
      return res.status(404).json({ message: "Sales order not found" });
    }

    // read before deleting - the cascade removes these rows, and the count is
    // reported back even on the forced path
    const linked = await db
      .select({
        orderNumber: workOrders.orderNumber,
        quantity: allocations.quantity,
      })
      .from(allocations)
      .innerJoin(workOrders, eq(allocations.workOrderId, workOrders.id))
      .where(eq(allocations.salesOrderId, params.id))
      .orderBy(allocations.id);

    if (linked.length > 0 && !force) {
      const total = linked.reduce((sum, link) => sum + link.quantity, 0);
      return res.status(409).json({
        message: `${salesOrder.orderNumber} has ${total} allocated units`,
        requiresConfirmation: true,
        allocations: linked,
      });
    }

    await db.delete(salesOrders).where(eq(salesOrders.id, params.id));

    res.json({
      orderNumber: salesOrder.orderNumber,
      deletedAllocations: linked.length,
    });
  } catch (error) {
    console.error("Error deleting sales order", error);
    res.status(500).json({ message: "Error deleting sales order" });
  }
});

export default router;
