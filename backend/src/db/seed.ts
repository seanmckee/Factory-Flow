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
  simulationRuns,
  factorySettings,
} from "./schema.js";

const db = drizzle(process.env.DATABASE_URL!);

async function seed() {
  console.log("Seeding database...");

  // runs first: their parts and released orders hold RESTRICT references to
  // work orders, and deleting a run cascades all of its history away
  await db.delete(simulationRuns);
  await db.delete(factorySettings);
  await db.delete(allocations);
  await db.delete(salesOrders);
  await db.delete(workOrders);
  await db.delete(routingSteps);
  await db.delete(routings);
  await db.delete(workCenters);
  await db.delete(parts);

  // Cost rates are tuning knobs, sized against what the constraint can earn:
  // the drill press moves ~60 units/day (28800 ticks / 480s), worth ~$1,750/day
  // of margin at these prices, against ~$1,350/day of standing costs + overhead
  // - profitable only while the constraint is fed, loss-making idle.
  await db.insert(factorySettings).values({
    id: 1,
    facilityOverheadCentsPerDay: 60_000, // $600/day - rent, the doors being open
    wipCarryingBpsPerDay: 1000, // 10%/day of material value - aggressive, so releasing everything visibly costs
  });

  const insertedWorkCenters = await db
    .insert(workCenters)
    .values([
      { name: "Raw Material", capacity: 1, standingCostCentsPerDay: 5_000 },
      { name: "Cutter", capacity: 1, standingCostCentsPerDay: 15_000 },
      { name: "Drill Press", capacity: 1, standingCostCentsPerDay: 30_000 },
      { name: "Deburr", capacity: 1, standingCostCentsPerDay: 10_000 },
      { name: "Inspection", capacity: 1, standingCostCentsPerDay: 10_000 },
      { name: "Packaging", capacity: 1, standingCostCentsPerDay: 5_000 },
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
  // Process times are minutes, not toy seconds, so the order book below spans
  // simulated days and per-day costs are material against the money earned.
  await db.insert(routingSteps).values([
    {
      routingId: flangeRouting.id,
      workCenterId: rawMaterial.id,
      sequence: 1,
      processTimeSeconds: 60,
      setupTimeSeconds: 0,
    },
    {
      routingId: flangeRouting.id,
      workCenterId: cutter.id,
      sequence: 2,
      processTimeSeconds: 180,
      setupTimeSeconds: 1,
    },
    {
      routingId: flangeRouting.id,
      workCenterId: drillPress.id,
      sequence: 3,
      processTimeSeconds: 480,
      setupTimeSeconds: 2,
    },
    {
      routingId: flangeRouting.id,
      workCenterId: inspection.id,
      sequence: 4,
      processTimeSeconds: 120,
      setupTimeSeconds: 0,
    },
    {
      routingId: flangeRouting.id,
      workCenterId: packaging.id,
      sequence: 5,
      processTimeSeconds: 60,
      setupTimeSeconds: 0,
    },
  ]);

  // Bracket: 6 steps, includes Deburr. Drill Press is the shared constraint.
  await db.insert(routingSteps).values([
    {
      routingId: bracketRouting.id,
      workCenterId: rawMaterial.id,
      sequence: 1,
      processTimeSeconds: 60,
      setupTimeSeconds: 0,
    },
    {
      routingId: bracketRouting.id,
      workCenterId: cutter.id,
      sequence: 2,
      processTimeSeconds: 240,
      setupTimeSeconds: 1,
    },
    {
      routingId: bracketRouting.id,
      workCenterId: drillPress.id,
      sequence: 3,
      processTimeSeconds: 480,
      setupTimeSeconds: 2,
    },
    {
      routingId: bracketRouting.id,
      workCenterId: deburr.id,
      sequence: 4,
      processTimeSeconds: 180,
      setupTimeSeconds: 1,
    },
    {
      routingId: bracketRouting.id,
      workCenterId: inspection.id,
      sequence: 5,
      processTimeSeconds: 120,
      setupTimeSeconds: 0,
    },
    {
      routingId: bracketRouting.id,
      workCenterId: packaging.id,
      sequence: 6,
      processTimeSeconds: 60,
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
        quantity: 50,
      },
      {
        orderNumber: "WO-1002",
        partId: flange.id,
        routingId: flangeRouting.id,
        quantity: 90,
      },
      {
        orderNumber: "WO-1003",
        partId: bracket.id,
        routingId: bracketRouting.id,
        quantity: 30,
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
      // Due days are sized against the drill press (~480s/unit, ~60/day; the
      // whole 170-unit book is ~2.83 drill-days): SO-2001 makes day 1 with a
      // few-sigma margin only if brackets release immediately and run first;
      // SO-2002 is comfortable brackets-first and late flanges-first, so the
      // due date agrees with the price signal (the $55 order is the one to
      // protect); SO-2003 makes day 3 only if the drill never starves, in
      // direct tension with the carrying cost that rewards releasing WO-1002
      // late.
      {
        orderNumber: "SO-2001",
        partId: bracket.id,
        quantity: 52,
        unitPriceCents: 5000,
        dueDay: 1,
      },
      {
        orderNumber: "SO-2002",
        partId: bracket.id,
        quantity: 28,
        unitPriceCents: 5500,
        dueDay: 2,
      },
      {
        orderNumber: "SO-2003",
        partId: flange.id,
        quantity: 90,
        unitPriceCents: 3000,
        dueDay: 3,
      },
    ])
    .returning();

  const [so2001, so2002, so2003] = insertedSalesOrders;
  if (!so2001 || !so2002 || !so2003) {
    throw new Error("Sales order insert failed");
  }

  await db.insert(allocations).values([
    // SO-2001 needs 52 brackets  takes two work orders to cover
    { salesOrderId: so2001.id, workOrderId: wo1001.id, quantity: 50 },
    { salesOrderId: so2001.id, workOrderId: wo1003.id, quantity: 2 },
    // WO-1003 makes 30  remaining 28 go to another customer at a higher price
    { salesOrderId: so2002.id, workOrderId: wo1003.id, quantity: 28 },
    // SO-2003 covered by a single work order
    { salesOrderId: so2003.id, workOrderId: wo1002.id, quantity: 90 },
  ]);

  console.log("Database Seeded");
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
