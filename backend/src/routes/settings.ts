import { Router } from "express";
import {
  getFactorySettings,
  updateFactorySettings,
} from "../lib/factorySettings.js";
import { parseOr400 } from "../lib/validate.js";
import { updateFactorySettingsSchema } from "../schemas/orders.js";

const router = Router();

/**
 * The facility-level cost rates — the live values runs freeze at creation.
 * A singleton, so the resource is the collection: GET and PATCH on `/`,
 * no `/:id`.
 */

router.get("/", async (_req, res) => {
  try {
    res.json(await getFactorySettings());
  } catch (error) {
    console.error("Error getting factory settings", error);
    res.status(500).json({ message: "Error getting factory settings" });
  }
});

router.patch("/", async (req, res) => {
  try {
    const body = parseOr400(updateFactorySettingsSchema, req.body, res);
    if (!body) return;

    const updates: {
      facilityOverheadCentsPerDay?: number;
      wipCarryingBpsPerDay?: number;
      shifts?: number;
      releasePolicy?: string;
      wipCap?: number;
      releaseLeadDays?: number;
      drumWorkCenterId?: number | null;
      drumBuffer?: number;
    } = {};
    if (body.facilityOverheadCentsPerDay !== undefined) {
      updates.facilityOverheadCentsPerDay = body.facilityOverheadCentsPerDay;
    }
    if (body.wipCarryingBpsPerDay !== undefined) {
      updates.wipCarryingBpsPerDay = body.wipCarryingBpsPerDay;
    }
    if (body.shifts !== undefined) {
      updates.shifts = body.shifts;
    }
    if (body.releasePolicy !== undefined) {
      updates.releasePolicy = body.releasePolicy;
    }
    if (body.wipCap !== undefined) {
      updates.wipCap = body.wipCap;
    }
    if (body.releaseLeadDays !== undefined) {
      updates.releaseLeadDays = body.releaseLeadDays;
    }
    if (body.drumWorkCenterId !== undefined) {
      updates.drumWorkCenterId = body.drumWorkCenterId;
    }
    if (body.drumBuffer !== undefined) {
      updates.drumBuffer = body.drumBuffer;
    }

    res.json(await updateFactorySettings(updates));
  } catch (error) {
    console.error("Error updating factory settings", error);
    res.status(500).json({ message: "Error updating factory settings" });
  }
});

export default router;
