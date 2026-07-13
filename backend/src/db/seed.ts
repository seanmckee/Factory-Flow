import "dotenv/config";

import { drizzle } from "drizzle-orm/neon-http";
import { parts, workCenters } from "./schema.js";

const db = drizzle(process.env.DATABASE_URL!);

async function seed() {
  console.log("Seeding database...");

  await db.delete(workCenters);
  await db.delete(parts);
  await db.insert(workCenters).values([
    {
      name: "Raw Material",
    },
    {
      name: "Cutter",
    },
    {
      name: "Drill Press",
    },
    {
      name: "Deburr",
    },
    {
      name: "Inspection",
    },
    {
      name: "Packaging",
    },
  ]);
  await db.insert(parts).values([
    { partNumber: "100-001", name: "Aluminum Bracket" },
    { partNumber: "100-002", name: "Steel Flange" },
    { partNumber: "100-003", name: "Hinge Plate" },
    { partNumber: "200-001", name: "Mounting Rail" },
    { partNumber: "200-002", name: "Pivot Arm" },
  ]);

  console.log("Database Seeded");
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
