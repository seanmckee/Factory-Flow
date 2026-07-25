import { Router } from "express";
import { db } from "../db/index.js";
import { routings, routingSteps } from "../db/schema.js";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const routing = await db.select().from(routings).where(eq(routings.id, id));
    if (routing.length === 0) {
      return res.status(404).json({ message: "Routing id not found" });
    }

    const matchingRoutingSteps = await db
      .select()
      .from(routingSteps)
      .where(eq(routingSteps.routingId, id))
      .orderBy(routingSteps.sequence);
    res.json({ ...routing[0], steps: matchingRoutingSteps });
  } catch (error) {
    res.status(500).json({ message: "Error fetching routing", error });
  }
});
export default router;
