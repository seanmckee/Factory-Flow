import { Router } from "express";
import { and, eq, ne } from "drizzle-orm";
import { db } from "../db/index.js";
import { routings, routingSteps, workCenters } from "../db/schema.js";
import { parseOr400 } from "../lib/validate.js";
import {
  createWorkCenterSchema,
  idParamSchema,
  updateWorkCenterSchema,
} from "../schemas/orders.js";

const router = Router();

/**
 * work_centers.name is unique, so a clash is a 409 rather than a constraint
 * error. Pre-checking keeps the message ours - see salesOrders.ts, which
 * pre-checks the part the same way. `excludeId` skips the row being renamed,
 * so PATCHing a center to the name it already has is not a conflict.
 */
async function nameTaken(name: string, excludeId?: number): Promise<boolean> {
  const where =
    excludeId === undefined
      ? eq(workCenters.name, name)
      : and(eq(workCenters.name, name), ne(workCenters.id, excludeId));

  const [clash] = await db.select({ id: workCenters.id }).from(workCenters).where(where);
  return clash !== undefined;
}

router.get("/", async (_req, res) => {
  try {
    // without an explicit order Postgres returns heap order, which shifts
    // every time a row is updated - keeps the cards in production-flow order
    const wcs = await db.select().from(workCenters).orderBy(workCenters.id);
    res.json(wcs);
  } catch (error) {
    console.error("Error getting work centers", error);
    res.status(500).json({ message: "Error getting work centers" });
  }
});

router.post("/", async (req, res) => {
  try {
    const body = parseOr400(createWorkCenterSchema, req.body, res);
    if (!body) return;

    if (await nameTaken(body.name)) {
      return res
        .status(409)
        .json({ message: `A work center named "${body.name}" already exists` });
    }

    // capacity is omitted rather than set to undefined: exactOptionalPropertyTypes
    // rejects the latter, and omitting it takes the column default of 1
    const values: {
      name: string;
      capacity?: number;
      standingCostCentsPerDay?: number;
    } = { name: body.name };
    if (body.capacity !== undefined) values.capacity = body.capacity;
    if (body.standingCostCentsPerDay !== undefined) {
      values.standingCostCentsPerDay = body.standingCostCentsPerDay;
    }

    const [created] = await db.insert(workCenters).values(values).returning();

    if (!created) {
      return res.status(500).json({ message: "Work center insert failed" });
    }

    res.status(201).json(created);
  } catch (error) {
    console.error("Error creating work center", error);
    res.status(500).json({ message: "Error creating work center" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const params = parseOr400(idParamSchema, req.params, res);
    if (!params) return;

    const body = parseOr400(updateWorkCenterSchema, req.body, res);
    if (!body) return;

    if (body.name !== undefined && (await nameTaken(body.name, params.id))) {
      return res
        .status(409)
        .json({ message: `A work center named "${body.name}" already exists` });
    }

    const updates: {
      name?: string;
      capacity?: number;
      standingCostCentsPerDay?: number;
    } = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.capacity !== undefined) updates.capacity = body.capacity;
    if (body.standingCostCentsPerDay !== undefined) {
      updates.standingCostCentsPerDay = body.standingCostCentsPerDay;
    }

    const [updated] = await db
      .update(workCenters)
      .set(updates)
      .where(eq(workCenters.id, params.id))
      .returning();

    if (!updated) {
      return res.status(404).json({ message: "Work center not found" });
    }

    res.json(updated);
  } catch (error) {
    console.error("Error updating work center", error);
    res.status(500).json({ message: "Error updating work center" });
  }
});

/**
 * Deleting a work center. routing_steps.work_center_id is ON DELETE RESTRICT,
 * so unlike the order routes there is no ?force= path - a referenced center
 * genuinely cannot be removed until its steps are. The 409 payload deliberately
 * omits `requiresConfirmation`, so the client's deleteConflict() helper ignores
 * it and the message lands in the error toast instead of a confirm dialog.
 */
router.delete("/:id", async (req, res) => {
  try {
    const params = parseOr400(idParamSchema, req.params, res);
    if (!params) return;

    const [workCenter] = await db
      .select()
      .from(workCenters)
      .where(eq(workCenters.id, params.id));
    if (!workCenter) {
      return res.status(404).json({ message: "Work center not found" });
    }

    const linked = await db
      .select({ name: routings.name, revision: routings.revision })
      .from(routingSteps)
      .innerJoin(routings, eq(routingSteps.routingId, routings.id))
      .where(eq(routingSteps.workCenterId, params.id))
      .orderBy(routingSteps.id);

    if (linked.length > 0) {
      // one step per routing is the common case, but a routing may visit the
      // same center twice - name each routing once
      const names = [...new Set(linked.map((r) => `${r.name} rev ${r.revision}`))];
      return res.status(409).json({
        message: `${workCenter.name} is used by ${linked.length} routing step${
          linked.length === 1 ? "" : "s"
        } in ${names.join(", ")} - remove those steps first`,
        routings: names,
      });
    }

    await db.delete(workCenters).where(eq(workCenters.id, params.id));

    res.json({ id: workCenter.id, name: workCenter.name });
  } catch (error) {
    console.error("Error deleting work center", error);
    res.status(500).json({ message: "Error deleting work center" });
  }
});

export default router;
