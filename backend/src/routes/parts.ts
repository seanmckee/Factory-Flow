import { Router } from "express";
import { db } from "../db/index.js";
import { parts } from "../db/schema.js";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const ps = await db.select().from(parts).orderBy(parts.id);
    res.json(ps);
  } catch (error) {
    res.status(500).json({ message: "Error getting parts", error });
  }
});
export default router;
