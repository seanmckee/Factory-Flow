import "dotenv/config";

import { drizzle } from "drizzle-orm/neon-http";
import {
  parts,
  workCenters,
  routings,
  routingSteps,
  workOrders,
} from "./schema.js";

const db = drizzle(process.env.DATABASE_URL!);

async function seed() {
  console.log("Seeding database...");

  await db.delete(workOrders);
  await db.delete(routingSteps);
  await db.delete(routings);
  await db.delete(workCenters);
  await db.delete(parts);

  const insertedWorkCenters = await db
    .insert(workCenters)
    .values([
      { name: "Raw Material" },
      { name: "Cutter" },
      { name: "Drill Press" },
      { name: "Deburr" },
      { name: "Inspection" },
      { name: "Packaging" },
    ])
    .returning();
  const insertedParts = await db
    .insert(parts)
    .values([
      { partNumber: "100-001", name: "Aluminum Bracket" },
      { partNumber: "100-002", name: "Steel Flange" },
      { partNumber: "100-003", name: "Hinge Plate" },
      { partNumber: "200-001", name: "Mounting Rail" },
      { partNumber: "200-002", name: "Pivot Arm" },
    ])
    .returning();

  const bracket = insertedParts.find((p) => p.partNumber === "100-001")!;
  const flange = insertedParts.find((p) => p.partNumber === "100-002")!;

  const [flangeRouting] = await db
    .insert(routings)
    .values({ partId: flange!.id, name: "Standard Flange Process" })
    .returning();

  const [bracketRouting] = await db
    .insert(routings)
    .values({ partId: bracket!.id, name: "Standard Bracket Process" })
    .returning();

  if (!bracketRouting || !flangeRouting)
    throw new Error("Routing insert failed");
  const [rawMaterial, cutter, drillPress, deburr, inspection, packaging] =
    insertedWorkCenters;
  if (
    !rawMaterial ||
    !cutter ||
    !drillPress ||
    !deburr ||
    !inspection ||
    !packaging
  ) {
    throw new Error("Work center insert failed");
  }

  await db.insert(routingSteps).values([
    {
      routingId: flangeRouting.id,
      workCenterId: rawMaterial.id,
      sequence: 1,
      processTimeSeconds: 3,
      setupTimeSeconds: 0,
    },
    {
      routingId: flangeRouting.id,
      workCenterId: cutter.id,
      sequence: 2,
      processTimeSeconds: 2,
      setupTimeSeconds: 1,
    },
    {
      routingId: flangeRouting.id,
      workCenterId: deburr.id,
      sequence: 3,
      processTimeSeconds: 8,
      setupTimeSeconds: 2,
    },
    {
      routingId: flangeRouting.id,
      workCenterId: inspection.id,
      sequence: 4,
      processTimeSeconds: 2,
      setupTimeSeconds: 0,
    },
    {
      routingId: flangeRouting.id,
      workCenterId: packaging.id,
      sequence: 5,
      processTimeSeconds: 3,
      setupTimeSeconds: 0,
    },
  ]);

  await db.insert(routingSteps).values([
    {
      routingId: bracketRouting.id,
      workCenterId: rawMaterial.id,
      sequence: 1,
      processTimeSeconds: 2,
      setupTimeSeconds: 0,
    },
    {
      routingId: bracketRouting.id,
      workCenterId: cutter.id,
      sequence: 2,
      processTimeSeconds: 4,
      setupTimeSeconds: 1,
    },
    {
      routingId: bracketRouting.id,
      workCenterId: drillPress.id,
      sequence: 3,
      processTimeSeconds: 8,
      setupTimeSeconds: 2,
    },
    {
      routingId: bracketRouting.id,
      workCenterId: deburr.id,
      sequence: 4,
      processTimeSeconds: 3,
      setupTimeSeconds: 1,
    },
    {
      routingId: bracketRouting.id,
      workCenterId: inspection.id,
      sequence: 5,
      processTimeSeconds: 3,
      setupTimeSeconds: 0,
    },
    {
      routingId: bracketRouting.id,
      workCenterId: packaging.id,
      sequence: 6,
      processTimeSeconds: 2,
      setupTimeSeconds: 0,
    },
  ]);
  await db.insert(workOrders).values([
    {
      orderNumber: "WO-1001",
      partId: bracket.id,
      routingId: bracketRouting.id,
      quantity: 10,
    },
    {
      orderNumber: "WO-1002",
      partId: bracket.id,
      routingId: flangeRouting.id,
      quantity: 25,
    },
    {
      orderNumber: "WO-1003",
      partId: bracket.id,
      routingId: bracketRouting.id,
      quantity: 5,
    },
  ]);
  console.log("Database Seeded");
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
