import "dotenv/config";

import { drizzle } from "drizzle-orm/neon-http";
import { workCenters } from "./schema.js";

const db = drizzle(process.env.DATABASE_URL!);

async function seed() {
  console.log("Seeding database...");

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

  console.log("✅ Work centers seeded!");
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
