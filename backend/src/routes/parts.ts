import { Router } from "express";
import { db } from "../db/index.js";
import { and, eq, ne } from "drizzle-orm";
import { parts, routings, salesOrders, workOrders } from "../db/schema.js";
import { parseOr400 } from "../lib/validate.js";
import {
  createPartSchema,
  forceQuerySchema,
  idParamSchema,
  updatePartSchema,
} from "../schemas/orders.js";

const router = Router();

/**
 * parts.part_number is unique, so a clash is a 409 rather than a constraint
 * error. `excludeId` skips the row being edited, so PATCHing a part to the
 * part number it already has is not a conflict.
 */
async function partNumberTaken(
  partNumber: string,
  excludeId?: number,
): Promise<boolean> {
  const where =
    excludeId === undefined
      ? eq(parts.partNumber, partNumber)
      : and(eq(parts.partNumber, partNumber), ne(parts.id, excludeId));

  const [clash] = await db.select({ id: parts.id }).from(parts).where(where);
  return clash !== undefined;
}

router.get("/", async (_req, res) => {
  try {
    const ps = await db.select().from(parts).orderBy(parts.id);
    res.json(ps);
  } catch (error) {
    console.error("Error getting parts", error);
    res.status(500).json({ message: "Error getting parts" });
  }
});

router.post("/", async (req, res) => {
  try {
    const body = parseOr400(createPartSchema, req.body, res);
    if (!body) return;

    const { partNumber, name, materialCostCents } = body;

    if (await partNumberTaken(partNumber)) {
      return res
        .status(409)
        .json({ message: `A part numbered "${partNumber}" already exists` });
    }

    const [part] = await db
      .insert(parts)
      .values({
        partNumber,
        name,
        materialCostCents,
      })
      .returning();

    if (!part) {
      return res.status(500).json({ message: "Error creating part" });
    }

    res.status(201).json(part);
  } catch (error) {
    console.error("Error creating part", error);
    res.status(500).json({ message: "Error creating part" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    // params before body so a bad id fails on the id, not the body
    const params = parseOr400(idParamSchema, req.params, res);
    if (!params) return;

    const body = parseOr400(updatePartSchema, req.body, res);
    if (!body) return;

    if (
      body.partNumber !== undefined &&
      (await partNumberTaken(body.partNumber, params.id))
    ) {
      return res.status(409).json({
        message: `A part numbered "${body.partNumber}" already exists`,
      });
    }

    const updates: {
      partNumber?: string;
      name?: string;
      materialCostCents?: number;
    } = {};
    if (body.partNumber !== undefined) updates.partNumber = body.partNumber;
    if (body.name !== undefined) updates.name = body.name;
    if (body.materialCostCents !== undefined) {
      updates.materialCostCents = body.materialCostCents;
    }

    const [updated] = await db
      .update(parts)
      .set(updates)
      .where(eq(parts.id, params.id))
      .returning();

    // no row came back means no row matched that id
    if (!updated) {
      return res.status(404).json({ message: "Part not found" });
    }

    res.json(updated);
  } catch (error) {
    console.error("Error updating part", error);
    res.status(500).json({ message: "Error updating part" });
  }
});

/**
 * Deleting a part. Its three foreign keys disagree, so this has two distinct
 * conflict shapes:
 *
 * - work_orders.part_id and sales_orders.part_id are ON DELETE RESTRICT, so an
 *   ordered part cannot be removed at all. That 409 omits requiresConfirmation,
 *   which makes deleteConflict() on the client ignore it and toast the message.
 * - routings.part_id is ON DELETE CASCADE, so routings (and their steps, which
 *   cascade in turn) would be destroyed silently. That 409 sets
 *   requiresConfirmation and the client re-sends with ?force=true.
 *
 * The RESTRICT check has to come first: when an order references the part no
 * amount of force helps, and offering a confirm dialog would be a lie.
 */
router.delete("/:id", async (req, res) => {
  try {
    const params = parseOr400(idParamSchema, req.params, res);
    if (!params) return;
    const query = parseOr400(forceQuerySchema, req.query, res);
    if (!query) return;
    const force = query.force === "true";

    const [part] = await db.select().from(parts).where(eq(parts.id, params.id));
    if (!part) {
      return res.status(404).json({ message: "Part not found" });
    }

    const [linkedWorkOrders, linkedSalesOrders] = await Promise.all([
      db
        .select({ orderNumber: workOrders.orderNumber })
        .from(workOrders)
        .where(eq(workOrders.partId, params.id))
        .orderBy(workOrders.id),
      db
        .select({ orderNumber: salesOrders.orderNumber })
        .from(salesOrders)
        .where(eq(salesOrders.partId, params.id))
        .orderBy(salesOrders.id),
    ]);

    const orderNumbers = [...linkedSalesOrders, ...linkedWorkOrders].map(
      (order) => order.orderNumber,
    );

    if (orderNumbers.length > 0) {
      return res.status(409).json({
        message: `${part.partNumber} is used by ${orderNumbers.join(
          ", ",
        )} - delete those orders first`,
        orders: orderNumbers,
      });
    }

    // read before deleting - the cascade removes these rows, and the count is
    // reported back even on the forced path
    const linkedRoutings = await db
      .select({ name: routings.name, revision: routings.revision })
      .from(routings)
      .where(eq(routings.partId, params.id))
      .orderBy(routings.id);

    if (linkedRoutings.length > 0 && !force) {
      const names = linkedRoutings.map((r) => `${r.name} rev ${r.revision}`);
      const one = linkedRoutings.length === 1;
      return res.status(409).json({
        message: `${part.partNumber} has ${linkedRoutings.length} routing${
          one ? "" : "s"
        }: ${names.join(", ")}. Deleting the part removes ${
          one ? "it" : "them"
        } and every step inside.`,
        requiresConfirmation: true,
        routings: names,
      });
    }

    await db.delete(parts).where(eq(parts.id, params.id));

    res.json({
      id: part.id,
      partNumber: part.partNumber,
      deletedRoutings: linkedRoutings.length,
    });
  } catch (error) {
    console.error("Error deleting part", error);
    res.status(500).json({ message: "Error deleting part" });
  }
});

export default router;
