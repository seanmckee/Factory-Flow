import { Router } from "express";
import { db } from "../db/index.js";
import { routings, routingSteps } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { parseOr400 } from "../lib/validate.js";
import { idParamSchema, routingQuerySchema } from "../schemas/orders.js";

const router = Router();

// Registered before "/:id" - Express matches in definition order, so a list
// route declared afterwards would be swallowed by the param route.
// Returns routings without their steps; GET /:id is what serves steps.
router.get("/", async (req, res) => {
  try {
    const query = parseOr400(routingQuerySchema, req.query, res);
    if (!query) return;

    const selection = db
      .select({
        id: routings.id,
        partId: routings.partId,
        name: routings.name,
        revision: routings.revision,
      })
      .from(routings);

    const result =
      query.partId === undefined
        ? await selection.orderBy(routings.id)
        : await selection
            .where(eq(routings.partId, query.partId))
            .orderBy(routings.id);

    res.json(result);
  } catch (error) {
    console.error("Error listing routings", error);
    res.status(500).json({ message: "Error listing routings" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const params = parseOr400(idParamSchema, req.params, res);
    if (!params) return;

    const routing = await db
      .select()
      .from(routings)
      .where(eq(routings.id, params.id));
    if (routing.length === 0) {
      return res.status(404).json({ message: "Routing id not found" });
    }

    const matchingRoutingSteps = await db
      .select()
      .from(routingSteps)
      .where(eq(routingSteps.routingId, params.id))
      .orderBy(routingSteps.sequence);
    res.json({ ...routing[0], steps: matchingRoutingSteps });
  } catch (error) {
    console.error("Error fetching routing", error);
    res.status(500).json({ message: "Error fetching routing" });
  }
});
export default router;
