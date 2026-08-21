import { Router } from "express";
import { db } from "../db/index.js";
import {
  parts,
  routings,
  routingSteps,
  workCenters,
  workOrders,
} from "../db/schema.js";
import { eq, inArray } from "drizzle-orm";
import { parseOr400 } from "../lib/validate.js";
import {
  createRoutingSchema,
  idParamSchema,
  replaceStepsSchema,
  routingQuerySchema,
  updateRoutingSchema,
} from "../schemas/orders.js";

const router = Router();

type StepInput = {
  workCenterId: number;
  processTimeSeconds: number;
  setupTimeSeconds: number;
};

/**
 * Every step must point at a work center that exists. Checked in one query
 * rather than per step, and reported by id so the client can say which row is
 * wrong. routing_steps.work_center_id is RESTRICT, so a bad id would otherwise
 * surface as a constraint error mid-transaction.
 */
async function missingWorkCenterIds(steps: StepInput[]): Promise<number[]> {
  const ids = [...new Set(steps.map((step) => step.workCenterId))];
  const found = await db
    .select({ id: workCenters.id })
    .from(workCenters)
    .where(inArray(workCenters.id, ids));
  const foundIds = new Set(found.map((row) => row.id));
  return ids.filter((id) => !foundIds.has(id));
}

/** Position comes from array order; sequence is 1-based and always contiguous. */
function sequenced(routingId: number, steps: StepInput[]) {
  return steps.map((step, index) => ({
    routingId,
    workCenterId: step.workCenterId,
    sequence: index + 1,
    processTimeSeconds: step.processTimeSeconds,
    setupTimeSeconds: step.setupTimeSeconds,
  }));
}

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

    // step counts are grouped in JS after a second select, like the other
    // routes - a routing with no steps can't be produced, so the count matters
    // enough to carry on the summary
    const counts = new Map<number, number>();
    if (result.length > 0) {
      const stepRows = await db
        .select({ routingId: routingSteps.routingId })
        .from(routingSteps)
        .where(
          inArray(
            routingSteps.routingId,
            result.map((routing) => routing.id),
          ),
        );
      for (const row of stepRows) {
        counts.set(row.routingId, (counts.get(row.routingId) ?? 0) + 1);
      }
    }

    res.json(
      result.map((routing) => ({
        ...routing,
        stepCount: counts.get(routing.id) ?? 0,
      })),
    );
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
/**
 * A routing and its steps are created together - a routing with no steps can't
 * produce anything, so the schema requires at least one. Sequence numbers come
 * from array order, and the whole thing runs in a transaction so a bad work
 * center id can't leave a stepless routing behind.
 */
router.post("/", async (req, res) => {
  try {
    const body = parseOr400(createRoutingSchema, req.body, res);
    if (!body) return;

    const [part] = await db
      .select()
      .from(parts)
      .where(eq(parts.id, body.partId));
    if (!part) {
      return res.status(400).json({ message: "Part not found" });
    }

    const missing = await missingWorkCenterIds(body.steps);
    if (missing.length > 0) {
      return res
        .status(400)
        .json({ message: `Work center not found: ${missing.join(", ")}` });
    }

    const created = await db.transaction(async (tx) => {
      const values: { partId: number; name: string; revision?: string } = {
        partId: body.partId,
        name: body.name,
      };
      if (body.revision !== undefined) values.revision = body.revision;

      const [routing] = await tx.insert(routings).values(values).returning();
      if (!routing) return null;

      const steps = await tx
        .insert(routingSteps)
        .values(sequenced(routing.id, body.steps))
        .returning();

      return { ...routing, steps };
    });

    if (!created) {
      return res.status(500).json({ message: "Routing insert failed" });
    }

    // same shape as GET /:id so the client can treat both responses identically
    res.status(201).json(created);
  } catch (error) {
    console.error("Error creating routing", error);
    res.status(500).json({ message: "Error creating routing" });
  }
});

/** Metadata only. Steps are replaced through PUT /:id/steps. */
router.patch("/:id", async (req, res) => {
  try {
    const params = parseOr400(idParamSchema, req.params, res);
    if (!params) return;

    const body = parseOr400(updateRoutingSchema, req.body, res);
    if (!body) return;

    const updates: { name?: string; revision?: string } = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.revision !== undefined) updates.revision = body.revision;

    const [updated] = await db
      .update(routings)
      .set(updates)
      .where(eq(routings.id, params.id))
      .returning();

    if (!updated) {
      return res.status(404).json({ message: "Routing not found" });
    }

    res.json(updated);
  } catch (error) {
    console.error("Error updating routing", error);
    res.status(500).json({ message: "Error updating routing" });
  }
});

/**
 * Replace every step in one shot rather than editing them individually.
 * UNIQUE(routing_id, sequence) makes incremental reordering hostile - swapping
 * two steps collides halfway through - so the whole list is deleted and
 * reinserted inside a transaction, which also renumbers sequences contiguously.
 *
 * Deliberately allowed while work orders reference the routing: changing a
 * process and watching the effect is the point of the simulator. A run already
 * in flight keeps the routing it was released with, since the frontend caches
 * routings per released order.
 */
router.put("/:id/steps", async (req, res) => {
  try {
    const params = parseOr400(idParamSchema, req.params, res);
    if (!params) return;

    const body = parseOr400(replaceStepsSchema, req.body, res);
    if (!body) return;

    const [routing] = await db
      .select()
      .from(routings)
      .where(eq(routings.id, params.id));
    if (!routing) {
      return res.status(404).json({ message: "Routing not found" });
    }

    const missing = await missingWorkCenterIds(body.steps);
    if (missing.length > 0) {
      return res
        .status(400)
        .json({ message: `Work center not found: ${missing.join(", ")}` });
    }

    const steps = await db.transaction(async (tx) => {
      await tx
        .delete(routingSteps)
        .where(eq(routingSteps.routingId, params.id));

      return tx
        .insert(routingSteps)
        .values(sequenced(params.id, body.steps))
        .returning();
    });

    res.json({ ...routing, steps });
  } catch (error) {
    console.error("Error replacing routing steps", error);
    res.status(500).json({ message: "Error replacing routing steps" });
  }
});

/**
 * Steps cascade away with the routing, which needs no confirming - they are the
 * routing's own content, not separate records someone would miss. Work orders
 * are different: work_orders.routing_id is ON DELETE RESTRICT, so a routing
 * that has been released can't be removed. That 409 omits requiresConfirmation,
 * so deleteConflict() ignores it and the message lands in the error toast.
 */
router.delete("/:id", async (req, res) => {
  try {
    const params = parseOr400(idParamSchema, req.params, res);
    if (!params) return;

    const [routing] = await db
      .select()
      .from(routings)
      .where(eq(routings.id, params.id));
    if (!routing) {
      return res.status(404).json({ message: "Routing not found" });
    }

    const linked = await db
      .select({ orderNumber: workOrders.orderNumber })
      .from(workOrders)
      .where(eq(workOrders.routingId, params.id))
      .orderBy(workOrders.id);

    if (linked.length > 0) {
      const orderNumbers = linked.map((order) => order.orderNumber);
      return res.status(409).json({
        message: `${routing.name} is used by ${orderNumbers.join(
          ", ",
        )} - delete those work orders first`,
        orders: orderNumbers,
      });
    }

    // counted before the delete - the cascade takes them with the routing
    const steps = await db
      .select({ id: routingSteps.id })
      .from(routingSteps)
      .where(eq(routingSteps.routingId, params.id));

    await db.delete(routings).where(eq(routings.id, params.id));

    res.json({
      id: routing.id,
      name: routing.name,
      deletedSteps: steps.length,
    });
  } catch (error) {
    console.error("Error deleting routing", error);
    res.status(500).json({ message: "Error deleting routing" });
  }
});

export default router;
