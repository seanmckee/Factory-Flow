import { Router } from "express";
import { db } from "../db/index.js";
import {
  allocations,
  routings,
  routingSteps,
  salesOrders,
} from "../db/schema.js";
import { eq } from "drizzle-orm";

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
    res.status(500).json({ message: "Failed to get Sales Orders", error });
  }
});
export default router;
