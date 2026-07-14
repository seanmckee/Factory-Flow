import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { parts, routings, routingSteps, workCenters } from "./db/schema.js";
import { db } from "./db/index.js";
import { eq } from "drizzle-orm";

dotenv.config();

const app = express();
const port = process.env.PORT ?? 3000;

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/factory", (_req, res) => {
  res.json({
    machines: [
      { id: "raw", name: "Raw Material" },
      { id: "cutter", name: "Cutter" },
      { id: "finisher", name: "Finisher" },
    ],
  });
});

app.listen(port, () => {
  console.log(`Backend running on http://localhost:${port}`);
});

app.get("/api/work-centers", async (_req, res) => {
  try {
    const wcs = await db.select().from(workCenters);
    res.json(wcs);
  } catch (error) {
    res.status(500).json({ message: "Error getting work centers", error });
  }
});

app.get("/api/parts", async (_req, res) => {
  try {
    const ps = await db.select().from(parts);
    res.json(ps);
  } catch (error) {
    res.status(500).json({ message: "Error getting parts", error });
  }
});

app.get("/api/routings/:id", async (req, res) => {
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
