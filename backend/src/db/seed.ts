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

/* ---------------------------------------------------------------------------
 * The playground seed: a ten-centre floor, ten parts with full routings, and a
 * 29-order / ~3,600-unit book spanning three demand waves over 18 due-days —
 * deep enough that long runs need no manual data entry, and priced so the
 * capital levers are real decisions rather than always-buy or never-buy.
 *
 * The economics, so retuning stays explainable:
 *
 * - Base burn is ~$3,340/day at one shift: $600 facility overhead + $1,700 of
 *   standing cost + $1,040 of wages (ten operators, 8 staffed hours).
 * - The constraint ladder. Demand on the Drill Press is ~23.5 press-days
 *   against an 18-day due book, so one press makes wave 1 (barely, if
 *   prioritized) and drowns in waves 2–3 — a second press is how OTD survives.
 *   The Cutter carries ~16 cutter-days and feeds almost everything, so it
 *   binds next once presses multiply; the CNC Mill (~9 mill-days, and the
 *   highest margin per second in the shop) is the third buy. Welding, Lathe
 *   and Paint sit at 3–7 days each: comfortable, until fillers pile on.
 * - Margin per constraint-second orders the dispatch decision: Manifold
 *   13.3¢/mill-s and Housing 13.9¢/mill-s (the premium line), Rail 11.8¢ and
 *   Bracket 10.0¢/drill-s, Pivot 9.2¢, Flange 5.8¢. Hinge, Spacer and Bushing
 *   never touch the drill or mill — nearly-free money while the shop has
 *   slack, and the first thing to shed when the Cutter or Lathe becomes the
 *   constraint (a spacer earns 5.6¢/cutter-s to the bracket's 20¢).
 * - The whole book carries ~$121k of margin against ~$43k of material.
 *   Released all at once at 10%/day carrying that floor costs ~$4,300/day —
 *   staged releases are not optional. Run solo (~26 days) the book nets
 *   roughly +$26k with waves 2–3 late; expanded early (2nd press, 2nd mill,
 *   2nd cutter and their operators, ~$4k of capital) it nets roughly +$48k
 *   with OTD intact. The controls are the difference.
 * ------------------------------------------------------------------------- */

// Capital prices follow one rule each, enforced by construction below: a
// machine costs four days of its own standing cost and salvages for half
// (churning costs real money — the model punishes indecision), and hiring an
// operator costs two staffed days of that operator's wage.
const CENTER_SPECS = [
  { name: "Raw Material", standingCostCentsPerDay: 5_000, wageCentsPerHour: 800 },
  { name: "Cutter", standingCostCentsPerDay: 15_000, wageCentsPerHour: 1200 },
  { name: "Lathe", standingCostCentsPerDay: 20_000, wageCentsPerHour: 1400 },
  { name: "CNC Mill", standingCostCentsPerDay: 35_000, wageCentsPerHour: 2000 },
  { name: "Drill Press", standingCostCentsPerDay: 30_000, wageCentsPerHour: 1800 },
  { name: "Welding", standingCostCentsPerDay: 18_000, wageCentsPerHour: 1600 },
  { name: "Deburr", standingCostCentsPerDay: 10_000, wageCentsPerHour: 1000 },
  { name: "Paint Booth", standingCostCentsPerDay: 22_000, wageCentsPerHour: 1200 },
  { name: "Inspection", standingCostCentsPerDay: 10_000, wageCentsPerHour: 1200 },
  { name: "Packaging", standingCostCentsPerDay: 5_000, wageCentsPerHour: 800 },
];

type StepSpec = {
  center: string;
  processTimeSeconds: number;
  setupTimeSeconds: number;
  scrapBps: number;
};

type PartSpec = {
  partNumber: string;
  name: string;
  materialCostCents: number;
  routingName: string;
  steps: StepSpec[];
};

// Process times are minutes-scale seconds; setups are one changeover per
// (work order, step), so splitting an order across work orders visibly costs
// constraint time. Scrap sits where value has already accrued — worst on the
// mill and weld, whose seconds are the dearest in the shop.
const PART_SPECS: PartSpec[] = [
  {
    partNumber: "100-001",
    name: "Aluminum Bracket",
    materialCostCents: 1200,
    routingName: "Standard Bracket Process",
    steps: [
      { center: "Raw Material", processTimeSeconds: 60, setupTimeSeconds: 0, scrapBps: 0 },
      { center: "Cutter", processTimeSeconds: 240, setupTimeSeconds: 300, scrapBps: 50 },
      { center: "Drill Press", processTimeSeconds: 480, setupTimeSeconds: 600, scrapBps: 100 },
      { center: "Deburr", processTimeSeconds: 180, setupTimeSeconds: 300, scrapBps: 50 },
      { center: "Inspection", processTimeSeconds: 120, setupTimeSeconds: 0, scrapBps: 0 },
      { center: "Packaging", processTimeSeconds: 60, setupTimeSeconds: 0, scrapBps: 0 },
    ],
  },
  {
    partNumber: "100-002",
    name: "Steel Flange",
    materialCostCents: 800,
    routingName: "Standard Flange Process",
    steps: [
      { center: "Raw Material", processTimeSeconds: 60, setupTimeSeconds: 0, scrapBps: 0 },
      { center: "Cutter", processTimeSeconds: 180, setupTimeSeconds: 300, scrapBps: 50 },
      { center: "Drill Press", processTimeSeconds: 480, setupTimeSeconds: 600, scrapBps: 100 },
      { center: "Inspection", processTimeSeconds: 120, setupTimeSeconds: 0, scrapBps: 0 },
      { center: "Packaging", processTimeSeconds: 60, setupTimeSeconds: 0, scrapBps: 0 },
    ],
  },
  {
    // Filler: no drill, no mill. Earns only while the Cutter and Deburr have
    // slack — and stops being worth cutting the moment they don't.
    partNumber: "100-003",
    name: "Hinge Plate",
    materialCostCents: 500,
    routingName: "Hinge Plate Process",
    steps: [
      { center: "Raw Material", processTimeSeconds: 60, setupTimeSeconds: 0, scrapBps: 0 },
      { center: "Cutter", processTimeSeconds: 120, setupTimeSeconds: 300, scrapBps: 50 },
      { center: "Deburr", processTimeSeconds: 120, setupTimeSeconds: 300, scrapBps: 50 },
      { center: "Packaging", processTimeSeconds: 30, setupTimeSeconds: 0, scrapBps: 0 },
    ],
  },
  {
    // The drill hog: 720s of press time a unit, priced to be worth it
    // (11.8¢/drill-s to the bracket's 10¢).
    partNumber: "200-001",
    name: "Mounting Rail",
    materialCostCents: 2500,
    routingName: "Mounting Rail Process",
    steps: [
      { center: "Raw Material", processTimeSeconds: 120, setupTimeSeconds: 0, scrapBps: 0 },
      { center: "Cutter", processTimeSeconds: 300, setupTimeSeconds: 300, scrapBps: 50 },
      { center: "Drill Press", processTimeSeconds: 720, setupTimeSeconds: 900, scrapBps: 150 },
      { center: "Deburr", processTimeSeconds: 240, setupTimeSeconds: 300, scrapBps: 50 },
      { center: "Inspection", processTimeSeconds: 180, setupTimeSeconds: 0, scrapBps: 0 },
      { center: "Packaging", processTimeSeconds: 60, setupTimeSeconds: 0, scrapBps: 0 },
    ],
  },
  {
    partNumber: "200-002",
    name: "Pivot Arm",
    materialCostCents: 1500,
    routingName: "Pivot Arm Process",
    steps: [
      { center: "Raw Material", processTimeSeconds: 60, setupTimeSeconds: 0, scrapBps: 0 },
      { center: "Lathe", processTimeSeconds: 300, setupTimeSeconds: 300, scrapBps: 50 },
      { center: "Drill Press", processTimeSeconds: 360, setupTimeSeconds: 600, scrapBps: 100 },
      { center: "Inspection", processTimeSeconds: 120, setupTimeSeconds: 0, scrapBps: 0 },
      { center: "Packaging", processTimeSeconds: 60, setupTimeSeconds: 0, scrapBps: 0 },
    ],
  },
  {
    // Pure filler: three fast steps. The 300s cutter setup against 90s units
    // is why spacer orders come big — a small batch is setup-dominated.
    partNumber: "300-001",
    name: "Spacer Kit",
    materialCostCents: 300,
    routingName: "Spacer Kit Process",
    steps: [
      { center: "Raw Material", processTimeSeconds: 30, setupTimeSeconds: 0, scrapBps: 0 },
      { center: "Cutter", processTimeSeconds: 90, setupTimeSeconds: 300, scrapBps: 50 },
      { center: "Packaging", processTimeSeconds: 30, setupTimeSeconds: 0, scrapBps: 0 },
    ],
  },
  {
    // Lathe filler — keeps the Lathe honest between pivot batches.
    partNumber: "300-002",
    name: "Threaded Bushing",
    materialCostCents: 600,
    routingName: "Threaded Bushing Process",
    steps: [
      { center: "Raw Material", processTimeSeconds: 30, setupTimeSeconds: 0, scrapBps: 0 },
      { center: "Lathe", processTimeSeconds: 240, setupTimeSeconds: 300, scrapBps: 75 },
      { center: "Deburr", processTimeSeconds: 60, setupTimeSeconds: 150, scrapBps: 25 },
      { center: "Packaging", processTimeSeconds: 30, setupTimeSeconds: 0, scrapBps: 0 },
    ],
  },
  {
    // The premium line: 1200s of mill time a unit at the best margin per
    // second in the shop — what the second mill is bought for.
    partNumber: "400-001",
    name: "Precision Manifold",
    materialCostCents: 6000,
    routingName: "Precision Manifold Process",
    steps: [
      { center: "Raw Material", processTimeSeconds: 120, setupTimeSeconds: 0, scrapBps: 0 },
      { center: "Cutter", processTimeSeconds: 240, setupTimeSeconds: 300, scrapBps: 50 },
      { center: "CNC Mill", processTimeSeconds: 1200, setupTimeSeconds: 1200, scrapBps: 200 },
      { center: "Drill Press", processTimeSeconds: 240, setupTimeSeconds: 600, scrapBps: 50 },
      { center: "Inspection", processTimeSeconds: 300, setupTimeSeconds: 0, scrapBps: 0 },
      { center: "Packaging", processTimeSeconds: 90, setupTimeSeconds: 0, scrapBps: 0 },
    ],
  },
  {
    partNumber: "400-002",
    name: "Gearbox Housing",
    materialCostCents: 4500,
    routingName: "Gearbox Housing Process",
    steps: [
      { center: "Raw Material", processTimeSeconds: 120, setupTimeSeconds: 0, scrapBps: 0 },
      { center: "CNC Mill", processTimeSeconds: 900, setupTimeSeconds: 1200, scrapBps: 150 },
      { center: "Drill Press", processTimeSeconds: 360, setupTimeSeconds: 600, scrapBps: 100 },
      { center: "Deburr", processTimeSeconds: 180, setupTimeSeconds: 300, scrapBps: 50 },
      { center: "Paint Booth", processTimeSeconds: 300, setupTimeSeconds: 300, scrapBps: 50 },
      { center: "Inspection", processTimeSeconds: 240, setupTimeSeconds: 0, scrapBps: 0 },
      { center: "Packaging", processTimeSeconds: 90, setupTimeSeconds: 0, scrapBps: 0 },
    ],
  },
  {
    // The Welding line's whole demand — skips drill and mill entirely, so
    // frames keep earning while the presses are buried.
    partNumber: "500-001",
    name: "Steel Frame Weldment",
    materialCostCents: 3500,
    routingName: "Frame Weldment Process",
    steps: [
      { center: "Raw Material", processTimeSeconds: 120, setupTimeSeconds: 0, scrapBps: 0 },
      { center: "Cutter", processTimeSeconds: 360, setupTimeSeconds: 300, scrapBps: 50 },
      { center: "Welding", processTimeSeconds: 600, setupTimeSeconds: 600, scrapBps: 150 },
      { center: "Deburr", processTimeSeconds: 240, setupTimeSeconds: 300, scrapBps: 50 },
      { center: "Paint Booth", processTimeSeconds: 360, setupTimeSeconds: 300, scrapBps: 50 },
      { center: "Inspection", processTimeSeconds: 180, setupTimeSeconds: 0, scrapBps: 0 },
      { center: "Packaging", processTimeSeconds: 120, setupTimeSeconds: 0, scrapBps: 0 },
    ],
  },
];

type BookEntry = {
  part: string;
  quantity: number;
  unitPriceCents: number;
  dueDay: number;
};

// Three waves. Wave 1 (due days 2–6) is makeable on the starting factory if
// releases are staged and the constraint runs the right parts. Wave 2 (8–12)
// is ~8 press-days and ~3 mill-days due inside five — on time only with the
// second press (and mill) bought early. Wave 3 (14–18) is ~11 more press-days:
// the expanded factory cruises, the starting one ships everything weeks late.
// Prices wobble a few dollars order to order, so the margin ordering is a fact
// about parts, not a single number to memorize.
const ORDER_BOOK: BookEntry[] = [
  // Wave 1
  { part: "100-001", quantity: 60, unitPriceCents: 6_000, dueDay: 2 },
  { part: "400-001", quantity: 25, unitPriceCents: 22_000, dueDay: 3 },
  { part: "100-002", quantity: 90, unitPriceCents: 3_600, dueDay: 4 },
  { part: "100-003", quantity: 120, unitPriceCents: 1_400, dueDay: 4 },
  { part: "500-001", quantity: 35, unitPriceCents: 13_000, dueDay: 5 },
  { part: "200-002", quantity: 60, unitPriceCents: 4_800, dueDay: 5 },
  { part: "300-002", quantity: 100, unitPriceCents: 1_800, dueDay: 6 },
  { part: "300-001", quantity: 200, unitPriceCents: 800, dueDay: 6 },
  // Wave 2
  { part: "400-001", quantity: 50, unitPriceCents: 21_500, dueDay: 8 },
  { part: "200-001", quantity: 60, unitPriceCents: 10_500, dueDay: 8 },
  { part: "400-002", quantity: 40, unitPriceCents: 17_000, dueDay: 9 },
  { part: "100-001", quantity: 120, unitPriceCents: 5_800, dueDay: 10 },
  { part: "500-001", quantity: 60, unitPriceCents: 12_800, dueDay: 10 },
  { part: "100-002", quantity: 150, unitPriceCents: 3_800, dueDay: 11 },
  { part: "100-003", quantity: 200, unitPriceCents: 1_300, dueDay: 11 },
  { part: "200-002", quantity: 100, unitPriceCents: 5_000, dueDay: 12 },
  { part: "300-002", quantity: 150, unitPriceCents: 1_700, dueDay: 12 },
  { part: "300-001", quantity: 300, unitPriceCents: 800, dueDay: 12 },
  // Wave 3
  { part: "400-001", quantity: 60, unitPriceCents: 22_500, dueDay: 14 },
  { part: "200-001", quantity: 80, unitPriceCents: 11_500, dueDay: 14 },
  { part: "400-002", quantity: 60, unitPriceCents: 17_500, dueDay: 15 },
  { part: "100-001", quantity: 150, unitPriceCents: 6_200, dueDay: 15 },
  { part: "500-001", quantity: 80, unitPriceCents: 13_500, dueDay: 16 },
  { part: "200-002", quantity: 120, unitPriceCents: 4_600, dueDay: 16 },
  { part: "100-002", quantity: 180, unitPriceCents: 3_500, dueDay: 17 },
  { part: "100-003", quantity: 250, unitPriceCents: 1_400, dueDay: 17 },
  { part: "300-002", quantity: 200, unitPriceCents: 1_800, dueDay: 17 },
  { part: "100-001", quantity: 100, unitPriceCents: 6_600, dueDay: 18 },
  { part: "300-001", quantity: 400, unitPriceCents: 900, dueDay: 18 },
];

/**
 * Overage units against scrap: every work order carries spares sized at 1.5×
 * the routing's expected loss plus one, so full delivery survives an ordinary
 * scrap draw (~2σ) without being certain. The spares are uncovered — they
 * consume material, carrying and constraint time and earn nothing — which is
 * exactly the trade a real overage decision is.
 */
function spareUnits(quantity: number, totalScrapBps: number): number {
  return Math.ceil((quantity * totalScrapBps * 1.5) / 10000) + 1;
}

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

  await db.insert(factorySettings).values({
    id: 1,
    facilityOverheadCentsPerDay: 60_000, // $600/day - rent, the doors being open
    wipCarryingBpsPerDay: 1000, // 10%/day of material value - releasing everything at once visibly costs
    shifts: 1,
  });

  const insertedWorkCenters = await db
    .insert(workCenters)
    .values(
      CENTER_SPECS.map((c) => ({
        name: c.name,
        capacity: 1,
        operators: 1,
        standingCostCentsPerDay: c.standingCostCentsPerDay,
        wageCentsPerHour: c.wageCentsPerHour,
        machinePurchaseCents: 4 * c.standingCostCentsPerDay,
        machineSalvageCents: 2 * c.standingCostCentsPerDay,
        operatorHireCents: 16 * c.wageCentsPerHour,
      })),
    )
    .returning();

  const centerIdByName = new Map(insertedWorkCenters.map((c) => [c.name, c.id]));

  const insertedParts = await db
    .insert(parts)
    .values(
      PART_SPECS.map((p) => ({
        partNumber: p.partNumber,
        name: p.name,
        materialCostCents: p.materialCostCents,
      })),
    )
    .returning();

  const partIdByNumber = new Map(insertedParts.map((p) => [p.partNumber, p.id]));

  // One routing per part, steps from the spec.
  const routingIdByPartNumber = new Map<string, number>();
  for (const spec of PART_SPECS) {
    const partId = partIdByNumber.get(spec.partNumber);
    if (partId === undefined) {
      throw new Error(`Part insert failed for ${spec.partNumber}`);
    }
    const [routing] = await db
      .insert(routings)
      .values({ partId, name: spec.routingName })
      .returning();
    if (!routing) {
      throw new Error(`Routing insert failed for ${spec.partNumber}`);
    }
    routingIdByPartNumber.set(spec.partNumber, routing.id);

    await db.insert(routingSteps).values(
      spec.steps.map((step, i) => {
        const workCenterId = centerIdByName.get(step.center);
        if (workCenterId === undefined) {
          throw new Error(`Unknown work center ${step.center}`);
        }
        return {
          routingId: routing.id,
          workCenterId,
          sequence: i + 1,
          processTimeSeconds: step.processTimeSeconds,
          setupTimeSeconds: step.setupTimeSeconds,
          scrapBps: step.scrapBps,
        };
      }),
    );
  }

  // One work order per sales order, WO-1001 ↔ SO-2001 and so on down the book,
  // with the work order carrying the spares and the allocation covering
  // exactly the sold quantity.
  const scrapBpsByPartNumber = new Map(
    PART_SPECS.map((p) => [
      p.partNumber,
      p.steps.reduce((sum, s) => sum + s.scrapBps, 0),
    ]),
  );

  const workOrderValues = ORDER_BOOK.map((entry, i) => {
    const partId = partIdByNumber.get(entry.part);
    const routingId = routingIdByPartNumber.get(entry.part);
    const totalScrapBps = scrapBpsByPartNumber.get(entry.part);
    if (partId === undefined || routingId === undefined || totalScrapBps === undefined) {
      throw new Error(`Order book references unknown part ${entry.part}`);
    }
    return {
      orderNumber: `WO-${1001 + i}`,
      partId,
      routingId,
      quantity: entry.quantity + spareUnits(entry.quantity, totalScrapBps),
    };
  });

  const insertedWorkOrders = await db
    .insert(workOrders)
    .values(workOrderValues)
    .returning();

  const salesOrderValues = ORDER_BOOK.map((entry, i) => {
    const partId = partIdByNumber.get(entry.part);
    if (partId === undefined) {
      throw new Error(`Order book references unknown part ${entry.part}`);
    }
    return {
      orderNumber: `SO-${2001 + i}`,
      partId,
      quantity: entry.quantity,
      unitPriceCents: entry.unitPriceCents,
      dueDay: entry.dueDay,
    };
  });

  const insertedSalesOrders = await db
    .insert(salesOrders)
    .values(salesOrderValues)
    .returning();

  // 1:1 allocations, one statement: ids come out ascending in insert order,
  // which is the order `calculateThroughput` consumes them in.
  const allocationValues = ORDER_BOOK.map((entry, i) => {
    const so = insertedSalesOrders[i];
    const wo = insertedWorkOrders[i];
    if (!so || !wo) {
      throw new Error(`Order insert failed at book index ${i}`);
    }
    return { salesOrderId: so.id, workOrderId: wo.id, quantity: entry.quantity };
  });

  await db.insert(allocations).values(allocationValues);

  const totalUnits = workOrderValues.reduce((sum, wo) => sum + wo.quantity, 0);
  const soldUnits = ORDER_BOOK.reduce((sum, e) => sum + e.quantity, 0);
  console.log(
    `Database seeded: ${CENTER_SPECS.length} work centers, ${PART_SPECS.length} parts/routings, ` +
      `${ORDER_BOOK.length} sales orders covering ${soldUnits} units ` +
      `(${totalUnits} released units including scrap spares), due days 2-18.`,
  );
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
