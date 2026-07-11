import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { workCenters } from "./db/schema.js";
import { db } from "./db/index.js";

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
