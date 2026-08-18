import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { workCenters } from "../db/schema.js";
import { parseOr400 } from "../lib/validate.js";
import { idParamSchema, updateWorkCenterSchema } from "../schemas/orders.js";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    // without an explicit order Postgres returns heap order, which shifts
    // every time a row is updated - keeps the cards in production-flow order
    const wcs = await db.select().from(workCenters).orderBy(workCenters.id);
    res.json(wcs);
  } catch (error) {
    res.status(500).json({ message: "Error getting work centers", error });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const params = parseOr400(idParamSchema, req.params, res);
    if (!params) return;

    const body = parseOr400(updateWorkCenterSchema, req.body, res);
    if (!body) return;

    const [updated] = await db
      .update(workCenters)
      .set({ capacity: body.capacity })
      .where(eq(workCenters.id, params.id))
      .returning();

    if (!updated) {
      return res.status(404).json({ message: "Work center not found" });
    }

    res.json(updated);
  } catch (error) {
    res.status(500).json({ message: "Error updating work center", error });
  }
});

export default router;
