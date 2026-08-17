import "dotenv/config";

import { drizzle } from "drizzle-orm/neon-http";
import {
  parts,
  workCenters,
  routings,
  routingSteps,
  workOrders,
  allocations,
  salesOrders,
} from "./schema.js";

const db = drizzle(process.env.DATABASE_URL!);

async function seed() {
  console.log("Seeding database...");

  await db.delete(allocations);
  await db.delete(salesOrders);
  await db.delete(workOrders);
  await db.delete(routingSteps);
  await db.delete(routings);
  await db.delete(workCenters);
  await db.delete(parts);

  const insertedWorkCenters = await db
    .insert(workCenters)
    .values([
      { name: "Raw Material", capacity: 1 },
      { name: "Cutter", capacity: 1 },
      { name: "Drill Press", capacity: 1 },
      { name: "Deburr", capacity: 1 },
      { name: "Inspection", capacity: 1 },
      { name: "Packaging", capacity: 1 },
    ])
    .returning();

  const insertedParts = await db
    .insert(parts)
    .values([
      {
        partNumber: "100-001",
        name: "Aluminum Bracket",
        materialCostCents: 1200,
      },
      { partNumber: "100-002", name: "Steel Flange", materialCostCents: 800 },
      { partNumber: "100-003", name: "Hinge Plate", materialCostCents: 500 },
      { partNumber: "200-001", name: "Mounting Rail", materialCostCents: 2500 },
      { partNumber: "200-002", name: "Pivot Arm", materialCostCents: 1500 },
    ])
    .returning();

  const bracket = insertedParts.find((p) => p.partNumber === "100-001")!;
  const flange = insertedParts.find((p) => p.partNumber === "100-002")!;

  const [flangeRouting] = await db
    .insert(routings)
    .values({ partId: flange.id, name: "Standard Flange Process" })
    .returning();

  const [bracketRouting] = await db
    .insert(routings)
    .values({ partId: bracket.id, name: "Standard Bracket Process" })
    .returning();

  if (!bracketRouting || !flangeRouting) {
    throw new Error("Routing insert failed");
  }

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

  // Flange: 5 steps, skips Deburr. Drill Press is the shared constraint.
  await db.insert(routingSteps).values([
    {
      routingId: flangeRouting.id,
      workCenterId: rawMaterial.id,
      sequence: 1,
      processTimeSeconds: 2,
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
      workCenterId: drillPress.id,
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
      processTimeSeconds: 2,
      setupTimeSeconds: 0,
    },
  ]);

  // Bracket: 6 steps, includes Deburr. Drill Press is the shared constraint.
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
      processTimeSeconds: 3,
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
      processTimeSeconds: 2,
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

  const insertedWorkOrders = await db
    .insert(workOrders)
    .values([
      {
        orderNumber: "WO-1001",
        partId: bracket.id,
        routingId: bracketRouting.id,
        quantity: 10,
      },
      {
        orderNumber: "WO-1002",
        partId: flange.id,
        routingId: flangeRouting.id,
        quantity: 25,
      },
      {
        orderNumber: "WO-1003",
        partId: bracket.id,
        routingId: bracketRouting.id,
        quantity: 5,
      },
    ])
    .returning();

  const [wo1001, wo1002, wo1003] = insertedWorkOrders;
  if (!wo1001 || !wo1002 || !wo1003) {
    throw new Error("Work order insert failed");
  }

  const insertedSalesOrders = await db
    .insert(salesOrders)
    .values([
      {
        orderNumber: "SO-2001",
        partId: bracket.id,
        quantity: 12,
        unitPriceCents: 5000,
      },
      {
        orderNumber: "SO-2002",
        partId: bracket.id,
        quantity: 3,
        unitPriceCents: 5500,
      },
      {
        orderNumber: "SO-2003",
        partId: flange.id,
        quantity: 25,
        unitPriceCents: 3000,
      },
    ])
    .returning();

  const [so2001, so2002, so2003] = insertedSalesOrders;
  if (!so2001 || !so2002 || !so2003) {
    throw new Error("Sales order insert failed");
  }

  await db.insert(allocations).values([
    // SO-2001 needs 12 brackets  takes two work orders to cover
    { salesOrderId: so2001.id, workOrderId: wo1001.id, quantity: 10 },
    { salesOrderId: so2001.id, workOrderId: wo1003.id, quantity: 2 },
    // WO-1003 makes 5  remaining 3 go to another customer at a higher price
    { salesOrderId: so2002.id, workOrderId: wo1003.id, quantity: 3 },
    // SO-2003 covered by a single work order
    { salesOrderId: so2003.id, workOrderId: wo1002.id, quantity: 25 },
  ]);

  console.log("Database Seeded");
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
