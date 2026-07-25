import { Router } from "express";
import { db } from "../db/index.js";
import { workCenters } from "../db/schema.js";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const wcs = await db.select().from(workCenters);
    res.json(wcs);
  } catch (error) {
    res.status(500).json({ message: "Error getting work centers", error });
  }
});
export default router;
