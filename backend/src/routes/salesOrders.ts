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

router.get("/", async (_req, res) => {
  try {
    const soData = await db.select().from(salesOrders);
    const allocationData = await db.select().from(allocations);
    res.json({ so: soData, all: allocationData });
  } catch (error) {
    res.status(500).json({ message: "Failed to get Sales Orders", error });
  }
});
export default router;
