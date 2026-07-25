import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { workOrders, parts } from "../db/schema.js";

const router = Router();

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
      .innerJoin(parts, eq(workOrders.partId, parts.id));

    res.json(orders);
  } catch (error) {
    console.error("Error getting work orders", error);
    res.status(500).json({ message: "Error getting work orders" });
  }
});

export default router;
