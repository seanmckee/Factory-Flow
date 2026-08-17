import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { workCenters } from "../db/schema.js";

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
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "Invalid work center id" });
    }

    const { capacity } = req.body;
    if (!Number.isInteger(capacity) || capacity < 1) {
      return res
        .status(400)
        .json({ message: "capacity must be an integer >= 1" });
    }

    const [updated] = await db
      .update(workCenters)
      .set({ capacity })
      .where(eq(workCenters.id, id))
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
