import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CostRates, DatedRate } from "./operatingExpense.js";
import { PROCESS_TIME_DEVIATION, sampleProcessTime } from "./sampleProcessTime.js";
import { simulateBatch, type RunBatch, type RunState } from "./simulateBatch.js";
import { setupKey } from "./observations.js";
import type { Routing, RoutingStep, WipPart, WorkCenter } from "./types.js";

/**
 * **Characterization, not specification.** Every other suite in this directory
 * says what the engine *should* do; this one pins what it *does*, as of the
 * tick-stepped implementation, so the event-driven rewrite can be shown to be
 * byte-identical rather than probably-the-same.
 *
 * It is deliberately one heavy fixture rather than many small ones. The small
 * cases are already covered by name next door, and what a rewrite breaks is
 * the interaction between them — contention at a bottleneck, admission order
 * deciding who pays a changeover, credit order deciding what a unit sold for.
 * Those only appear at scale, and none of them is a line anyone would think to
 * write a test for.
 *
 * Two things are pinned: a **hash** of the batch serialized whole, which is the
 * byte-identical guarantee, and a **digest** of aggregates, which is what tells
 * you *what* moved when the hash stops matching. A failing hash with a matching
 * digest means something changed that the digest doesn't summarize — check
 * `canonical` before believing it is cosmetic.
 *
 * When this fails during the port, the question is never "update the snapshot".
 * It is "which rule did the event queue express differently".
 */

const SEED = 20260904;
/** mid-run, so every rate epoch and carried remainder below is a real one */
const START_TICK = 40_000;
const BATCH_TICKS = 3_600;

/**
 * Five centres, one of them a hard bottleneck (the press, capacity 1) and one
 * no routing visits (the polisher) — an idle centre is an observation with a
 * denominator, and dropping it from the series is the easy mistake.
 */
const WORK_CENTERS = new Map<number, WorkCenter>([
  [10, { id: 10, capacity: 4 }], // saw
  [20, { id: 20, capacity: 1 }], // press — the constraint
  [30, { id: 30, capacity: 2 }], // mill
  [40, { id: 40, capacity: 3 }], // paint
  [50, { id: 50, capacity: 2 }], // polisher — never routed to
]);

const step = (
  workCenterId: number,
  processTimeSeconds: number,
  setupTimeSeconds = 0,
  scrapBps = 0,
): RoutingStep => ({ workCenterId, processTimeSeconds, setupTimeSeconds, scrapBps });

type WorkOrderSpec = {
  id: number;
  partId: number;
  units: number;
  /**
   * The step its units sit at as the batch opens. Past the end of `steps` on
   * purpose for one work order: a routing shortened under a part strands it,
   * and it finishes holding no machine.
   */
  startStepIndex: number;
  steps: RoutingStep[];
};

const WORK_ORDERS: WorkOrderSpec[] = [
  // the press queue: three work orders, 420 units, one machine
  {
    id: 100,
    partId: 1,
    units: 120,
    startStepIndex: 0,
    // scrap at the constraint: the press minute is spent, then the unit fails
    steps: [step(10, 30), step(20, 90, 300, 800), step(40, 45)],
  },
  {
    id: 101,
    partId: 2,
    units: 120,
    startStepIndex: 0,
    steps: [step(10, 20), step(30, 60, 0, 200), step(20, 75, 180), step(40, 30)],
  },
  // opens mid-route, already at the press, with its changeover already paid
  {
    id: 102,
    partId: 3,
    units: 90,
    startStepIndex: 1,
    steps: [step(30, 40, 120), step(20, 60, 240)],
  },
  // single step at a wide centre: this is the work order that actually ships,
  // so the credit path runs through a full allocation list and out the far side
  // scrap on a *last* step, so a ruined unit's sale passes to the next good
  // one and the work order under-delivers — scrap's whole money bite
  { id: 103, partId: 1, units: 120, startStepIndex: 0, steps: [step(40, 25, 0, 600)] },
  // scrap at 5%: short work orders, wasted machine time, frozen material
  {
    id: 104,
    partId: 4,
    units: 100,
    startStepIndex: 0,
    steps: [step(10, 15), step(30, 50, 60, 500)],
  },
  // stranded past the end of a one-step routing
  { id: 105, partId: 2, units: 5, startStepIndex: 1, steps: [step(10, 10)] },
];

const routingByWorkOrder = new Map<number, Routing>(
  WORK_ORDERS.map((spec) => [spec.id, { steps: spec.steps }]),
);

/**
 * The floor as the batch opens. One unit per work order is mid-process, which
 * is what exercises the claim pass that keeps a machine rather than re-admits
 * to it — chosen at `unitIndex` 0 so no centre opens over its own capacity,
 * which the engine permits and production can never produce.
 */
function openingFloor(): WipPart[] {
  const parts: WipPart[] = [];
  for (const spec of WORK_ORDERS) {
    const stepIndex = spec.startStepIndex;
    const current = spec.steps[stepIndex];
    for (let unitIndex = 0; unitIndex < spec.units; unitIndex++) {
      const actualProcessTimeSeconds = current
        ? sampleProcessTime(current.processTimeSeconds, PROCESS_TIME_DEVIATION, {
            seed: SEED,
            workOrderId: spec.id,
            unitIndex,
            stepIndex,
          })
        : 0;
      parts.push({
        id: `wo${spec.id}-u${unitIndex}`,
        workOrderId: spec.id,
        unitIndex,
        // staggered, so cycle time is not one number repeated
        releasedAtTick: START_TICK - 1_200 - (spec.id % 4) * 300 - (unitIndex % 11) * 7,
        stepIndex,
        progressSeconds:
          unitIndex === 0 && actualProcessTimeSeconds > 1 ? Math.floor(actualProcessTimeSeconds / 2) : 0,
        actualProcessTimeSeconds,
      });
    }
  }
  return parts;
}

const dated = (cents: number, sinceTick = 0): DatedRate => ({ cents, sinceTick });

/**
 * Every line of the P&L non-zero, and two rates dated after tick 0 — a capital
 * action moved them in an earlier batch, so the accrual's epoch arithmetic is
 * pinned rather than only its `t0 = 0` special case.
 */
const COSTS: CostRates = {
  dayTicks: 28_800,
  facilityOverheadCentsPerDay: 189_400,
  wipCarryingBpsPerDay: 150,
  standingCostByWorkCenter: new Map([
    [10, dated(2_400)],
    [20, dated(44_400, 39_000)],
    [30, dated(3_100)],
    [40, dated(1_800)],
    [50, dated(900, 38_500)],
  ]),
  wageCentsPerHourByWorkCenter: new Map([
    [10, dated(2_600)],
    [20, dated(3_200, 39_000)],
    [30, dated(2_900)],
    [40, dated(2_500)],
  ]),
};

function openingState(): RunState {
  return {
    tickNum: START_TICK,
    rngSeed: SEED,
    wipParts: openingFloor(),
    routingByWorkOrder,
    workCenters: WORK_CENTERS,
    workOrders: WORK_ORDERS.map((spec) => ({ id: spec.id, partId: spec.partId })),
    parts: [
      { id: 1, materialCostCents: 1_200 },
      { id: 2, materialCostCents: 3_400 },
      { id: 3, materialCostCents: 890 },
      { id: 4, materialCostCents: 15_000 },
    ],
    salesOrders: [
      { id: 200, unitPriceCents: 9_000, dueAtTick: 40_800 },
      { id: 201, unitPriceCents: 9_500, dueAtTick: null },
      { id: 202, unitPriceCents: 12_000, dueAtTick: 41_500 },
      { id: 203, unitPriceCents: 30_000, dueAtTick: 45_000 },
      { id: 204, unitPriceCents: 27_500, dueAtTick: null },
      // promised before these units were even released: legal, and already late
      { id: 205, unitPriceCents: 4_000, dueAtTick: 39_000 },
    ],
    // id order is what decides which order a unit sells to; every work order
    // here is deliberately under-covered, so uncovered units fall out the end
    allocations: [
      { id: 1, salesOrderId: 200, workOrderId: 103, quantity: 40 },
      { id: 2, salesOrderId: 201, workOrderId: 103, quantity: 30 },
      { id: 3, salesOrderId: 202, workOrderId: 104, quantity: 50 },
      { id: 4, salesOrderId: 203, workOrderId: 100, quantity: 100 },
      { id: 5, salesOrderId: 204, workOrderId: 101, quantity: 80 },
      { id: 6, salesOrderId: 200, workOrderId: 102, quantity: 60 },
      { id: 7, salesOrderId: 205, workOrderId: 105, quantity: 2 },
    ],
    costs: COSTS,
    // the batch opens partway into three work orders' allocation lists
    priorCounts: new Map([
      [100, 3],
      [103, 12],
      [104, 7],
    ]),
    carryRemainder: 1_234_567,
    // the press changeover for work order 102 was paid before this batch
    setupDone: new Set([setupKey(102, 1)]),
  };
}

/**
 * The batch serialized whole, field for field, in the order the engine built
 * it — array order included, since admission order is list order and a rewrite
 * that reorders the floor has changed who pays a setup.
 */
function canonical(batch: RunBatch): string {
  const lines: string[] = [
    `tickNum ${batch.tickNum}`,
    `carryRemainder ${batch.carryRemainder}`,
  ];
  for (const p of batch.wipParts) {
    lines.push(
      `wip ${p.id} ${p.workOrderId} ${p.unitIndex} ${p.releasedAtTick} ${p.stepIndex} ${p.progressSeconds} ${p.actualProcessTimeSeconds}`,
    );
  }
  for (const f of batch.finishedParts) {
    lines.push(
      `fin ${f.partId} ${f.workOrderId} ${f.releasedAtTick} ${f.completedAtTick} ${f.throughputCents} ${f.salesOrderId} ${f.unitPriceCents} ${f.materialCostCents} ${f.dueAtTick}`,
    );
  }
  for (const s of batch.scrappedParts) {
    lines.push(
      `scrap ${s.partId} ${s.workOrderId} ${s.unitIndex} ${s.releasedAtTick} ${s.scrappedAtTick} ${s.stepIndex} ${s.workCenterId} ${s.materialCostCents}`,
    );
  }
  for (const s of batch.setupsStarted) {
    lines.push(`setupStart ${s.workOrderId} ${s.stepIndex} ${s.atTick}`);
  }
  for (const t of batch.ticks) {
    const centres = t.workCenters
      .map((c) => `${c.workCenterId}:${c.busy}:${c.queued}:${c.capacity}`)
      .join(",");
    lines.push(
      `tick ${t.tickNum} ${t.throughputCents} ${t.wipCount} ${t.operatingExpenseCents} ${t.carryingCostCents} ${t.wageCents} ${centres}`,
    );
  }
  for (const [id, n] of [...batch.priorCounts].sort((a, b) => a[0] - b[0])) {
    lines.push(`prior ${id} ${n}`);
  }
  for (const key of [...batch.setupDone].sort()) {
    lines.push(`setupDone ${key}`);
  }
  return lines.join("\n");
}

const fingerprint = (batch: RunBatch): string =>
  createHash("sha256").update(canonical(batch)).digest("hex").slice(0, 32);

function countBy(rows: { workOrderId: number }[]): Record<number, number> {
  const counts = new Map<number, number>();
  for (const row of rows) counts.set(row.workOrderId, (counts.get(row.workOrderId) ?? 0) + 1);
  return Object.fromEntries([...counts].sort((a, b) => a[0] - b[0]));
}

/** What moved, for when the fingerprint says *something* did. */
function digest(batch: RunBatch) {
  const centres = new Map<number, { busy: number; queued: number; capacity: number }>();
  let throughputCents = 0;
  let operatingExpenseCents = 0;
  let carryingCostCents = 0;
  let wageCents = 0;

  for (const tick of batch.ticks) {
    throughputCents += tick.throughputCents;
    operatingExpenseCents += tick.operatingExpenseCents;
    carryingCostCents += tick.carryingCostCents;
    wageCents += tick.wageCents;
    for (const centre of tick.workCenters) {
      const at = centres.get(centre.workCenterId) ?? { busy: 0, queued: 0, capacity: 0 };
      at.busy += centre.busy;
      at.queued += centre.queued;
      at.capacity += centre.capacity;
      centres.set(centre.workCenterId, at);
    }
  }

  return {
    tickNum: batch.tickNum,
    tickRecords: batch.ticks.length,
    wipCount: batch.wipParts.length,
    wipByWorkOrder: countBy(batch.wipParts),
    finishedCount: batch.finishedParts.length,
    finishedByWorkOrder: countBy(batch.finishedParts),
    coveredUnits: batch.finishedParts.filter((f) => f.salesOrderId !== null).length,
    uncoveredUnits: batch.finishedParts.filter((f) => f.salesOrderId === null).length,
    promisedUnits: batch.finishedParts.filter((f) => f.dueAtTick !== null).length,
    scrappedCount: batch.scrappedParts.length,
    scrappedByWorkOrder: countBy(batch.scrappedParts),
    scrappedMaterialCents: batch.scrappedParts.reduce((n, s) => n + s.materialCostCents, 0),
    setupsStarted: batch.setupsStarted.map((s) => `${s.workOrderId}:${s.stepIndex}@${s.atTick}`),
    money: { throughputCents, operatingExpenseCents, carryingCostCents, wageCents },
    carryRemainder: batch.carryRemainder,
    centreTicks: Object.fromEntries(
      [...centres]
        .sort((a, b) => a[0] - b[0])
        .map(([id, at]) => [id, `busy ${at.busy} queued ${at.queued} capacity ${at.capacity}`]),
    ),
    priorCounts: Object.fromEntries([...batch.priorCounts].sort((a, b) => a[0] - b[0])),
  };
}

/**
 * Runs the same opening state as a sequence of batches, carrying exactly what
 * the run service carries between them, and stitches the pieces back into one
 * `RunBatch`. If chunking changes an answer, the engine is keeping state the
 * boundary does not carry.
 */
function chained(chunks: number[]): RunBatch {
  let state = openingState();
  const finishedParts: RunBatch["finishedParts"] = [];
  const scrappedParts: RunBatch["scrappedParts"] = [];
  const setupsStarted: RunBatch["setupsStarted"] = [];
  const ticks: RunBatch["ticks"] = [];
  let last: RunBatch | null = null;

  for (const chunk of chunks) {
    const batch = simulateBatch(state, chunk);
    finishedParts.push(...batch.finishedParts);
    scrappedParts.push(...batch.scrappedParts);
    setupsStarted.push(...batch.setupsStarted);
    ticks.push(...batch.ticks);
    last = batch;
    state = {
      ...state,
      tickNum: batch.tickNum,
      wipParts: batch.wipParts,
      priorCounts: batch.priorCounts,
      carryRemainder: batch.carryRemainder,
      setupDone: batch.setupDone,
    };
  }

  if (!last) throw new Error("chained() needs at least one chunk");
  return {
    tickNum: last.tickNum,
    wipParts: last.wipParts,
    finishedParts,
    scrappedParts,
    ticks,
    priorCounts: last.priorCounts,
    carryRemainder: last.carryRemainder,
    setupDone: last.setupDone,
    setupsStarted,
  };
}

describe("engine characterization (heavy floor, 555 units over one batch)", () => {
  const batch = simulateBatch(openingState(), BATCH_TICKS);

  it("produces a batch that is byte-identical to the tick-stepped engine's", () => {
    expect(fingerprint(batch)).toMatchInlineSnapshot(`"a77dad8dcb07045379fbb76f90171bcf"`);
  });

  it("produces these aggregates, so a broken fingerprint says what moved", () => {
    expect(digest(batch)).toMatchInlineSnapshot(`
      {
        "carryRemainder": 57511567,
        "centreTicks": {
          "10": "busy 7427 queued 356330 capacity 14400",
          "20": "busy 3600 queued 751143 capacity 3600",
          "30": "busy 5598 queued 354698 capacity 7200",
          "40": "busy 4564 queued 61932 capacity 10800",
          "50": "busy 0 queued 0 capacity 7200",
        },
        "coveredUnits": 96,
        "finishedByWorkOrder": {
          "100": 34,
          "102": 1,
          "103": 113,
          "104": 1,
          "105": 5,
        },
        "finishedCount": 154,
        "money": {
          "carryingCostCents": 3969,
          "operatingExpenseCents": 30251,
          "throughputCents": 1452910,
          "wageCents": 11200,
        },
        "priorCounts": {
          "100": 37,
          "102": 1,
          "103": 125,
          "104": 8,
          "105": 5,
        },
        "promisedUnits": 66,
        "scrappedByWorkOrder": {
          "100": 2,
          "101": 3,
          "103": 7,
        },
        "scrappedCount": 12,
        "scrappedMaterialCents": 21000,
        "setupsStarted": [
          "104:1@40009",
          "100:1@40024",
        ],
        "tickNum": 43600,
        "tickRecords": 3600,
        "uncoveredUnits": 58,
        "wipByWorkOrder": {
          "100": 84,
          "101": 117,
          "102": 89,
          "104": 99,
        },
        "wipCount": 389,
      }
    `);
  });

  it("answers the same however the batch is chunked", () => {
    for (const chunks of [[3_600], [1_800, 1_800], [1, 3_599], [900, 900, 900, 900]]) {
      expect(canonical(chained(chunks))).toBe(canonical(batch));
    }
  });
});
