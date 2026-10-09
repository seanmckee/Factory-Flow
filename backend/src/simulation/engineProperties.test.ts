import { describe, expect, it } from "vitest";

/**
 * Properties that must hold over **any** factory, checked against hundreds of
 * random ones rather than the handful anybody thinks to write down.
 *
 * This file is what is left of the differential harness that proved the
 * event-driven port: it ran these same generated factories through the old
 * tick-stepped engine and the new one and compared the batches byte for byte,
 * 2,000 of them, and that is how the one real bug was found — a part moving to
 * its next step frees a machine behind it, and the first cut of the segment
 * optimization did not count that as a reason for the next tick to differ.
 *
 * The old engine is gone, so the comparison is gone with it; the
 * **characterization** suite is the permanent pin on what the engine answers.
 * What survives here is the half that never needed two engines: a batch
 * chunked any way must answer identically, which is the property every
 * batch-boundary decision in the run service rests on — and the property that
 * bug would also have broken, since a segment that spans a boundary is a
 * segment that cannot be replayed.
 */
import { simulateBatch, type RunBatch, type RunState } from "./simulateBatch.js";
import type { CostRates, DatedRate } from "./operatingExpense.js";
import { PROCESS_TIME_DEVIATION, sampleProcessTime } from "./sampleProcessTime.js";
import type { Routing, RoutingStep, WipPart, WorkCenter } from "./types.js";

/** a tiny deterministic PRNG, so a failing case is reproducible from its index */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canonical(b: RunBatch): string {
  const out: string[] = [];
  for (const p of b.wipParts)
    out.push(`w ${p.id} ${p.stepIndex} ${p.progressSeconds} ${p.actualProcessTimeSeconds}`);
  for (const f of b.finishedParts)
    out.push(`f ${f.partId} ${f.completedAtTick} ${f.throughputCents} ${f.salesOrderId} ${f.dueAtTick}`);
  for (const s of b.scrappedParts)
    out.push(`s ${s.partId} ${s.scrappedAtTick} ${s.stepIndex} ${s.workCenterId} ${s.materialCostCents}`);
  for (const s of b.setupsStarted) out.push(`u ${s.workOrderId} ${s.stepIndex} ${s.atTick}`);
  for (const t of b.ticks)
    out.push(
      `t ${t.tickNum} ${t.throughputCents} ${t.wipCount} ${t.operatingExpenseCents} ${t.carryingCostCents} ${t.wageCents} ` +
        t.workCenters.map((c) => `${c.workCenterId}:${c.busy}:${c.queued}:${c.capacity}`).join(","),
    );
  for (const [k, v] of [...b.priorCounts].sort((a, c) => a[0] - c[0])) out.push(`p ${k} ${v}`);
  for (const k of [...b.setupDone].sort()) out.push(`d ${k}`);
  out.push(`end ${b.tickNum} carry=${b.carryRemainder}`);
  return out.join("\n");
}

/** A random factory and floor. Nothing here is tuned; the point is coverage. */
function randomState(seed: number): { state: () => RunState; ticks: number } {
  const r = rng(seed);
  const pick = (n: number) => Math.floor(r() * n);

  const centreCount = 2 + pick(4);
  const centreIds = Array.from({ length: centreCount }, (_, i) => (i + 1) * 10);
  const workCenters = new Map<number, WorkCenter>(
    centreIds.map((id) => [id, { id, capacity: 1 + pick(3) }]),
  );

  const specs = Array.from({ length: 1 + pick(5) }, (_, i) => {
    const stepCount = 1 + pick(4);
    const steps: RoutingStep[] = Array.from({ length: stepCount }, () => ({
      workCenterId: centreIds[pick(centreCount)]!,
      // short process times, so a small batch still sees many transitions
      processTimeSeconds: 1 + pick(12),
      setupTimeSeconds: r() < 0.4 ? pick(8) : 0,
      scrapBps: r() < 0.4 ? pick(2500) : 0,
    }));
    return {
      id: 100 + i,
      partId: 1 + pick(2),
      units: 1 + pick(14),
      // sometimes past the end of the routing: a part stranded by a shortened one
      start: r() < 0.12 ? stepCount : pick(stepCount),
      steps,
    };
  });

  const rngSeed = 1 + pick(100000);
  const startTick = pick(50000);

  // Every draw happens **once**, here. `build()` only clones: the two engines
  // must be handed the same factory, and a generator that drew inside the
  // builder quietly handed them different ones.
  const openingFloor = specs.flatMap((spec) =>
    Array.from({ length: spec.units }, (_, unitIndex) => {
      const s = spec.steps[spec.start];
      const actual = s
        ? sampleProcessTime(s.processTimeSeconds, PROCESS_TIME_DEVIATION, {
            seed: rngSeed, workOrderId: spec.id, unitIndex, stepIndex: spec.start,
          })
        : 0;
      return {
        id: `wo${spec.id}-u${unitIndex}`,
        workOrderId: spec.id,
        unitIndex,
        releasedAtTick: Math.max(0, startTick - pick(500)),
        stepIndex: spec.start,
        progressSeconds: r() < 0.25 && actual > 1 ? 1 + pick(actual - 1) : 0,
        actualProcessTimeSeconds: actual,
      } satisfies WipPart;
    }),
  );

  const dated = (c: number): DatedRate => ({
    cents: c,
    sinceTick: r() < 0.3 ? pick(startTick + 1) : 0,
  });
  const costs: CostRates = {
    dayTicks: 1 + pick(28800),
    facilityOverheadCentsPerDay: pick(200000),
    wipCarryingBpsPerDay: pick(400),
    standingCostByWorkCenter: new Map(centreIds.map((id) => [id, dated(pick(50000))])),
    wageCentsPerHourByWorkCenter: new Map(centreIds.map((id) => [id, dated(pick(5000))])),
  };
  const parts = [
    { id: 1, materialCostCents: 500 + pick(4000) },
    { id: 2, materialCostCents: 500 + pick(4000) },
  ];
  const salesOrders = [
    { id: 200, unitPriceCents: 1000 + pick(20000), dueAtTick: startTick + pick(1000) },
    { id: 201, unitPriceCents: 1000 + pick(20000), dueAtTick: null },
  ];
  const allocations = specs.flatMap((spec, i) => [
    { id: i * 2 + 1, salesOrderId: 200, workOrderId: spec.id, quantity: pick(spec.units + 1) },
    { id: i * 2 + 2, salesOrderId: 201, workOrderId: spec.id, quantity: pick(spec.units + 1) },
  ]);
  const carryRemainder = pick(10_000);
  const priorCounts = specs.map((spec) => [spec.id, pick(3)] as const);
  const setupDone = r() < 0.3 ? [`${specs[0]!.id}:0`] : [];
  const ticks = pick(400);

  const build = (): RunState => ({
    tickNum: startTick,
    rngSeed,
    wipParts: openingFloor.map((part) => ({ ...part })),
    routingByWorkOrder: new Map<number, Routing>(
      specs.map((spec) => [spec.id, { steps: spec.steps }]),
    ),
    workCenters,
    workOrders: specs.map((spec) => ({ id: spec.id, partId: spec.partId })),
    parts,
    salesOrders,
    allocations,
    costs,
    carryRemainder,
    priorCounts: new Map(priorCounts),
    setupDone: new Set(setupDone),
  });

  return { state: build, ticks };
}

describe("engine properties over random factories", () => {
  it("answers identically however a batch is chunked", () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 600; seed++) {
      const { state, ticks } = randomState(seed);
      if (ticks < 4) continue;
      const whole = canonical(simulateBatch(state(), ticks));
      let s = state();
      const parts: RunBatch[] = [];
      let left = ticks;
      for (const n of [1, Math.floor(ticks / 3), ticks - 1 - Math.floor(ticks / 3)]) {
        const take = Math.min(n, left);
        const b = simulateBatch(s, take);
        parts.push(b);
        left -= take;
        s = { ...s, tickNum: b.tickNum, wipParts: b.wipParts, priorCounts: b.priorCounts, carryRemainder: b.carryRemainder, setupDone: b.setupDone };
      }
      if (left > 0) parts.push(simulateBatch(s, left));
      const last = parts.at(-1)!;
      const merged: RunBatch = {
        tickNum: last.tickNum,
        wipParts: last.wipParts,
        finishedParts: parts.flatMap((p) => p.finishedParts),
        scrappedParts: parts.flatMap((p) => p.scrappedParts),
        ticks: parts.flatMap((p) => p.ticks),
        priorCounts: last.priorCounts,
        carryRemainder: last.carryRemainder,
        setupDone: last.setupDone,
        setupsStarted: parts.flatMap((p) => p.setupsStarted),
      };
      if (canonical(merged) !== whole) failures.push(`seed ${seed} ticks ${ticks}`);
    }
    expect(failures.join("\n")).toBe("");
  });
});
