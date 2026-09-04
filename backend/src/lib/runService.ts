import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  routingSteps,
  routings,
  runCapitalActions,
  runFinishedParts,
  runReleasedOrders,
  runScrappedParts,
  runTickWorkCenters,
  runTicks,
  runWipParts,
  runWorkCenters,
  runWorkOrderSteps,
  simulationRuns,
  workCenters,
  workOrders,
} from "../db/schema.js";
import { TICKS_PER_DAY } from "../simulation/operatingExpense.js";
import {
  PROCESS_TIME_DEVIATION,
  sampleProcessTime,
} from "../simulation/sampleProcessTime.js";
import { simulateBatch } from "../simulation/simulateBatch.js";
import { getFactorySettings } from "./factorySettings.js";
import { HttpError } from "./httpError.js";
import { loadRunState, type RunRow } from "./runState.js";

/**
 * The write side of the run API: creating a run, releasing into it and
 * advancing it, all under the run's lock. The reads — summaries, metrics, the
 * floor, the tick series — live in `runReads.ts`, and the state loader both
 * sides share in `runState.ts`.
 */

/**
 * How many ticks are simulated per transaction — one staffed hour. The point
 * of advancing in memory is that a fast-forward isn't a round trip per
 * simulated second, but a single unbounded transaction would hold a Neon
 * connection for as long as the whole run and lose everything on a failure —
 * so a long advance is several batches and a crash costs at most one of them.
 * Raised from 500 when the seed moved to day scale: the pure simulation runs
 * ~116k ticks/s, so the wall time of a day is almost entirely write round
 * trips, and per-batch fixed cost (BEGIN, the WIP replace, COMMIT) was most
 * of them.
 */
const TICKS_PER_BATCH = 3600;

/**
 * Rows per insert statement, sized per table to Postgres's ~65,535
 * bind-parameter cap with headroom. The flat 1,000-row chunk this replaces
 * made the Neon round trip the bottleneck rather than the parameter cap: a
 * simulated day is ~211k rows, and every chunk is a round trip.
 */
function chunkFor(paramsPerRow: number): number {
  return Math.floor(60_000 / paramsPerRow);
}

function chunked<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/**
 * Runs `work` with the run held. Advancing replaces the run's WIP rows
 * wholesale, so a release that landed mid-batch would be deleted by the write
 * that follows it — both operations take the lock rather than only advance.
 *
 * The claim is a conditional update, which is atomic: two concurrent callers
 * cannot both see `idle`. It is deliberately outside the caller's transaction,
 * since a lock nobody else can observe until commit is not a lock. A process
 * that dies mid-batch therefore leaves the run held, and 3.3's reset route is
 * what releases it.
 */
async function withRunLock<T>(
  runId: number,
  work: (run: RunRow) => Promise<T>,
): Promise<T> {
  const [held] = await db
    .update(simulationRuns)
    .set({ status: "advancing" })
    .where(
      and(eq(simulationRuns.id, runId), eq(simulationRuns.status, "idle")),
    )
    .returning();

  if (!held) {
    const [existing] = await db
      .select({ id: simulationRuns.id })
      .from(simulationRuns)
      .where(eq(simulationRuns.id, runId));
    if (!existing) throw new HttpError(404, `Run ${runId} not found`);
    throw new HttpError(409, `Run ${runId} is already advancing`);
  }

  try {
    return await work(held);
  } finally {
    // the work either committed or rolled back, so the run is consistent
    // either way and goes back to idle rather than to a failed state
    await db
      .update(simulationRuns)
      .set({ status: "idle" })
      .where(eq(simulationRuns.id, runId));
  }
}

export type CreateRunOverrides = {
  facilityOverheadCentsPerDay?: number;
  wipCarryingBpsPerDay?: number;
  /** staffed 8-hour shifts per calendar day; frozen as `day_ticks` */
  shifts?: number;
};

/**
 * Creates a run and freezes the factory's config into it: capacities and
 * standing costs per centre, the facility-level rates, and the day length.
 * From here on the run reads its own copies, never `work_centers` or
 * `factory_settings`, so editing a rate leaves this run — and every run
 * already created — alone. The overrides replace the facility-level rates
 * only; per-centre rates are 6E's capital-actions territory.
 */
export async function createRun(
  name: string,
  rngSeed: number,
  overrides: CreateRunOverrides = {},
): Promise<RunRow> {
  // upsert-then-read is idempotent, so it can sit outside the transaction
  const settings = await getFactorySettings();

  return db.transaction(async (tx) => {
    const [run] = await tx
      .insert(simulationRuns)
      .values({
        name,
        rngSeed,
        // the day's width is frozen here and never reinterpreted: a second
        // shift is a longer day of the same one-second ticks
        dayTicks: (overrides.shifts ?? settings.shifts) * TICKS_PER_DAY,
        facilityOverheadCentsPerDay:
          overrides.facilityOverheadCentsPerDay ??
          settings.facilityOverheadCentsPerDay,
        wipCarryingBpsPerDay:
          overrides.wipCarryingBpsPerDay ?? settings.wipCarryingBpsPerDay,
      })
      .returning();
    if (!run) throw new HttpError(500, "Run insert failed");

    const centers = await tx
      .select({
        id: workCenters.id,
        capacity: workCenters.capacity,
        operators: workCenters.operators,
        standingCostCentsPerDay: workCenters.standingCostCentsPerDay,
        wageCentsPerHour: workCenters.wageCentsPerHour,
        machinePurchaseCents: workCenters.machinePurchaseCents,
        machineSalvageCents: workCenters.machineSalvageCents,
        operatorHireCents: workCenters.operatorHireCents,
      })
      .from(workCenters);

    if (centers.length > 0) {
      // the prices are frozen too, not just the rates: a capital action mid-run
      // charges what the factory cost when the run started, so a price edit
      // cannot change what a decision already taken was worth
      await tx.insert(runWorkCenters).values(
        centers.map((center) => ({
          runId: run.id,
          workCenterId: center.id,
          capacity: center.capacity,
          operators: center.operators,
          standingCostCentsPerDay: center.standingCostCentsPerDay,
          wageCentsPerHour: center.wageCentsPerHour,
          machinePurchaseCents: center.machinePurchaseCents,
          machineSalvageCents: center.machineSalvageCents,
          operatorHireCents: center.operatorHireCents,
        })),
      );
    }

    return run;
  });
}

export type ReleaseResult = {
  workOrderId: number;
  partsReleased: number;
  releasedAtTick: number;
};

/**
 * Puts a work order's parts on the run's floor, pinning the steps they will
 * follow. The pin is why editing the routing afterwards cannot re-plan them.
 *
 * Parts are instantiated at step 0 with their first process time already
 * drawn, matching what the tick does at every later step transition.
 */
export async function releaseWorkOrder(
  runId: number,
  workOrderId: number,
): Promise<ReleaseResult> {
  return withRunLock(runId, (run) =>
    db.transaction(async (tx) => {
      const [workOrder] = await tx
        .select()
        .from(workOrders)
        .where(eq(workOrders.id, workOrderId));
      if (!workOrder) {
        throw new HttpError(404, `Work order ${workOrderId} not found`);
      }

      const [already] = await tx
        .select({ workOrderId: runReleasedOrders.workOrderId })
        .from(runReleasedOrders)
        .where(
          and(
            eq(runReleasedOrders.runId, runId),
            eq(runReleasedOrders.workOrderId, workOrderId),
          ),
        );
      if (already) {
        throw new HttpError(
          409,
          `Work order ${workOrderId} is already released into run ${runId}`,
        );
      }

      const [routing] = await tx
        .select({ id: routings.id, revision: routings.revision })
        .from(routings)
        .where(eq(routings.id, workOrder.routingId));
      if (!routing) {
        throw new HttpError(
          404,
          `Routing ${workOrder.routingId} not found`,
        );
      }

      const steps = await tx
        .select({
          workCenterId: routingSteps.workCenterId,
          processTimeSeconds: routingSteps.processTimeSeconds,
          setupTimeSeconds: routingSteps.setupTimeSeconds,
          scrapBps: routingSteps.scrapBps,
        })
        .from(routingSteps)
        .where(eq(routingSteps.routingId, routing.id))
        .orderBy(routingSteps.sequence);

      const firstStep = steps[0];
      if (!firstStep) {
        throw new HttpError(
          400,
          `Routing ${routing.id} has no steps, so nothing can be released against it`,
        );
      }

      await tx.insert(runReleasedOrders).values({
        runId,
        workOrderId,
        routingId: routing.id,
        routingRevision: routing.revision,
      });

      // sequences are renumbered from array order, as the live table's own
      // wholesale replace does, so the engine's step index matches the column
      await tx.insert(runWorkOrderSteps).values(
        steps.map((step, sequence) => ({
          runId,
          workOrderId,
          sequence,
          workCenterId: step.workCenterId,
          processTimeSeconds: step.processTimeSeconds,
          setupTimeSeconds: step.setupTimeSeconds,
          scrapBps: step.scrapBps,
        })),
      );

      const newParts = Array.from(
        { length: workOrder.quantity },
        (_, unitIndex) => ({
          runId,
          partUuid: crypto.randomUUID(),
          workOrderId,
          unitIndex,
          releasedAtTick: run.tickNum,
          stepIndex: 0,
          progressSeconds: 0,
          actualProcessTimeSeconds: sampleProcessTime(
            firstStep.processTimeSeconds,
            PROCESS_TIME_DEVIATION,
            { seed: run.rngSeed, workOrderId, unitIndex, stepIndex: 0 },
          ),
        }),
      );

      for (const slice of chunked(newParts, chunkFor(8))) {
        await tx.insert(runWipParts).values(slice);
      }

      return {
        workOrderId,
        partsReleased: newParts.length,
        releasedAtTick: run.tickNum,
      };
    }),
  );
}

export type AdvanceResult = {
  tickNum: number;
  ticksAdvanced: number;
  throughputCents: number;
  /** standing costs + facility overhead over the advance, summed like throughput */
  operatingExpenseCents: number;
  /** the holding charge over the advance */
  carryingCostCents: number;
  /** operator pay over the advance — the fourth line of the P&L */
  wageCents: number;
  /**
   * Units ruined over the advance — an agent-visible signal beside the money,
   * costing nothing to report since the batches already hold the rows.
   */
  scrappedCount: number;
  /**
   * Parts still on the floor when the advance stopped. Reported so a caller
   * advancing until the run goes idle can terminate on the advance itself
   * rather than following every call with a `GET /:id`, whose answer could
   * already be a batch stale. It costs nothing: the surviving WIP is what the
   * last batch handed back.
   */
  wipCount: number;
};

/**
 * Advances a run, in batches of `TICKS_PER_BATCH`, each batch one transaction.
 *
 * State is loaded once and carried between batches in memory: the survivors,
 * the tick number and the per-work-order finished counts all come back out of
 * `simulateBatch`, so a five-thousand-tick advance reads the database once and
 * writes ten times.
 */
export async function advanceRun(
  runId: number,
  ticks: number,
): Promise<AdvanceResult> {
  if (ticks < 1) throw new HttpError(400, "ticks must be at least 1");

  return withRunLock(runId, async (run) => {
    let state = await loadRunState(run);
    let throughputCents = 0;
    let operatingExpenseCents = 0;
    let carryingCostCents = 0;
    let wageCents = 0;
    let scrappedCount = 0;

    for (let remaining = ticks; remaining > 0; ) {
      const size = Math.min(remaining, TICKS_PER_BATCH);
      const batch = simulateBatch(state, size);

      await db.transaction(async (tx) => {
        // the survivors replace the stored set: after a batch nearly every
        // part has moved, and no row references a WIP part by id
        await tx.delete(runWipParts).where(eq(runWipParts.runId, runId));
        for (const slice of chunked(batch.wipParts, chunkFor(8))) {
          await tx.insert(runWipParts).values(
            slice.map((part) => ({
              runId,
              partUuid: part.id,
              workOrderId: part.workOrderId,
              unitIndex: part.unitIndex,
              releasedAtTick: part.releasedAtTick,
              stepIndex: part.stepIndex,
              progressSeconds: part.progressSeconds,
              actualProcessTimeSeconds: part.actualProcessTimeSeconds,
            })),
          );
        }

        for (const slice of chunked(batch.finishedParts, chunkFor(10))) {
          await tx.insert(runFinishedParts).values(
            slice.map((part) => ({
              runId,
              partUuid: part.partId,
              workOrderId: part.workOrderId,
              releasedAtTick: part.releasedAtTick,
              completedAtTick: part.completedAtTick,
              throughputCents: part.throughputCents,
              salesOrderId: part.salesOrderId,
              unitPriceCents: part.unitPriceCents,
              materialCostCents: part.materialCostCents,
              dueAtTick: part.dueAtTick,
            })),
          );
        }

        for (const slice of chunked(batch.scrappedParts, chunkFor(9))) {
          await tx.insert(runScrappedParts).values(
            slice.map((part) => ({
              runId,
              partUuid: part.partId,
              workOrderId: part.workOrderId,
              unitIndex: part.unitIndex,
              releasedAtTick: part.releasedAtTick,
              scrappedAtTick: part.scrappedAtTick,
              sequence: part.stepIndex,
              workCenterId: part.workCenterId,
              materialCostCents: part.materialCostCents,
            })),
          );
        }

        // a handful of rows per run's whole life, so per-row updates are fine
        for (const setup of batch.setupsStarted) {
          await tx
            .update(runWorkOrderSteps)
            .set({ setupStartedAtTick: setup.atTick })
            .where(
              and(
                eq(runWorkOrderSteps.runId, runId),
                eq(runWorkOrderSteps.workOrderId, setup.workOrderId),
                eq(runWorkOrderSteps.sequence, setup.stepIndex),
              ),
            );
        }

        for (const slice of chunked(batch.ticks, chunkFor(7))) {
          await tx.insert(runTicks).values(
            slice.map((tick) => ({
              runId,
              tickNum: tick.tickNum,
              throughputCents: tick.throughputCents,
              wipCount: tick.wipCount,
              operatingExpenseCents: tick.operatingExpenseCents,
              carryingCostCents: tick.carryingCostCents,
              wageCents: tick.wageCents,
            })),
          );
        }

        // the per-center rows key the tick rows above, so they go in after
        const centerRows = batch.ticks.flatMap((tick) =>
          tick.workCenters.map((center) => ({
            runId,
            tickNum: tick.tickNum,
            workCenterId: center.workCenterId,
            busy: center.busy,
            queued: center.queued,
            capacity: center.capacity,
          })),
        );
        for (const slice of chunked(centerRows, chunkFor(6))) {
          await tx.insert(runTickWorkCenters).values(slice);
        }

        await tx
          .update(simulationRuns)
          .set({ tickNum: batch.tickNum, carryRemainder: batch.carryRemainder })
          .where(eq(simulationRuns.id, runId));
      });

      for (const tick of batch.ticks) {
        throughputCents += tick.throughputCents;
        operatingExpenseCents += tick.operatingExpenseCents;
        carryingCostCents += tick.carryingCostCents;
        wageCents += tick.wageCents;
      }
      scrappedCount += batch.scrappedParts.length;
      state = {
        ...state,
        tickNum: batch.tickNum,
        wipParts: batch.wipParts,
        priorCounts: batch.priorCounts,
        carryRemainder: batch.carryRemainder,
        setupDone: batch.setupDone,
      };
      remaining -= size;
    }

    return {
      tickNum: state.tickNum,
      ticksAdvanced: ticks,
      throughputCents,
      operatingExpenseCents,
      carryingCostCents,
      wageCents,
      scrappedCount,
      wipCount: state.wipParts.length,
    };
  });
}

export type CapitalActionKind =
  | "buy_machine"
  | "retire_machine"
  | "hire_operator"
  | "fire_operator";

export type CapitalActionResult = {
  id: number;
  kind: CapitalActionKind;
  workCenterId: number;
  appliedAtTick: number;
  /** frozen; positive is money out, negative is salvage coming back */
  spendCents: number;
  machinesAfter: number;
  operatorsAfter: number;
};

/**
 * Applies a capital action to a run: the only thing that changes a run's own
 * frozen config, and the only place money leaves at a moment rather than
 * accruing per tick.
 *
 * It takes the same lock as advancing and releasing, which is what makes the
 * effective-dating exact: a batch cannot span the change, so the engine still
 * sees one rate per batch. The new rate is dated at the run's current tick and
 * therefore bites the *next* one — the tick the run has already lived through
 * belongs to the old factory.
 *
 * The spend comes from the run's frozen prices rather than from the caller. A
 * decision's cost is the factory's, and freezing it is what stops a later
 * price edit from rewriting what a finished run paid.
 */
export async function applyCapitalAction(
  runId: number,
  kind: CapitalActionKind,
  workCenterId: number,
): Promise<CapitalActionResult> {
  return withRunLock(runId, (run) =>
    db.transaction(async (tx) => {
      const [center] = await tx
        .select()
        .from(runWorkCenters)
        .where(
          and(
            eq(runWorkCenters.runId, runId),
            eq(runWorkCenters.workCenterId, workCenterId),
          ),
        );
      if (!center) {
        throw new HttpError(
          404,
          `Run ${runId} has no work center ${workCenterId}`,
        );
      }

      let machines = center.capacity;
      let operators = center.operators;
      let spendCents = 0;
      // only the rate the action moves is re-dated: re-phasing an untouched
      // rate would shift its sub-cent schedule for no reason
      const updates: {
        capacity?: number;
        operators?: number;
        standingCostEffectiveFromTick?: number;
        wageEffectiveFromTick?: number;
      } = {};

      switch (kind) {
        case "buy_machine":
          machines += 1;
          spendCents = center.machinePurchaseCents;
          updates.capacity = machines;
          updates.standingCostEffectiveFromTick = run.tickNum;
          break;
        case "retire_machine":
          if (machines === 0) {
            throw new HttpError(
              409,
              `Work center ${workCenterId} has no machines to retire`,
            );
          }
          machines -= 1;
          // salvage is a negative spend, so the P&L's capital line is one sum
          spendCents = -center.machineSalvageCents;
          updates.capacity = machines;
          updates.standingCostEffectiveFromTick = run.tickNum;
          break;
        case "hire_operator":
          operators += 1;
          spendCents = center.operatorHireCents;
          updates.operators = operators;
          updates.wageEffectiveFromTick = run.tickNum;
          break;
        case "fire_operator":
          if (operators === 0) {
            throw new HttpError(
              409,
              `Work center ${workCenterId} has no operators to let go`,
            );
          }
          operators -= 1;
          // firing is free by design: a crew you can shed cheaply is the temp
          // lever, and it is what gives a shift's commitment a price to beat
          spendCents = 0;
          updates.operators = operators;
          updates.wageEffectiveFromTick = run.tickNum;
          break;
      }

      await tx
        .update(runWorkCenters)
        .set(updates)
        .where(
          and(
            eq(runWorkCenters.runId, runId),
            eq(runWorkCenters.workCenterId, workCenterId),
          ),
        );

      const [action] = await tx
        .insert(runCapitalActions)
        .values({
          runId,
          kind,
          workCenterId,
          appliedAtTick: run.tickNum,
          spendCents,
          machinesAfter: machines,
          operatorsAfter: operators,
        })
        .returning();
      if (!action) throw new HttpError(500, "Capital action insert failed");

      return {
        id: action.id,
        kind,
        workCenterId,
        appliedAtTick: action.appliedAtTick,
        spendCents: action.spendCents,
        machinesAfter: action.machinesAfter,
        operatorsAfter: action.operatorsAfter,
      };
    }),
  );
}

/**
 * Clears a lock left behind by a process that died mid-batch. The only way out
 * of `advancing`, since the lock is deliberately not transactional — a lock
 * that rolls back with its own transaction cannot stop a second caller.
 *
 * Safe because the batch it was holding either committed or rolled back: a run
 * is never half-written, so there is no repair to do beyond letting it move
 * again. Deliberately not a "reset": re-creating a run with the same seed
 * reproduces it exactly, so rewinding one is not a feature anybody needs.
 */
export async function unlockRun(runId: number): Promise<RunRow> {
  const [unlocked] = await db
    .update(simulationRuns)
    .set({ status: "idle" })
    .where(eq(simulationRuns.id, runId))
    .returning();
  if (!unlocked) throw new HttpError(404, `Run ${runId} not found`);
  return unlocked;
}

/**
 * Deletes a run and, by cascade, all of its history. Pre-checks for forks so
 * the `parent_run_id` RESTRICT surfaces as a 409 with our own message rather
 * than a constraint error.
 */
export async function deleteRun(runId: number): Promise<{ id: number; name: string }> {
  const forks = await db
    .select({ id: simulationRuns.id })
    .from(simulationRuns)
    .where(eq(simulationRuns.parentRunId, runId));

  if (forks.length > 0) {
    throw new HttpError(
      409,
      `Run ${runId} was forked by run${forks.length > 1 ? "s" : ""} ${forks
        .map((fork) => fork.id)
        .join(", ")}, which would lose the run they are compared against`,
    );
  }

  const [deleted] = await db
    .delete(simulationRuns)
    .where(eq(simulationRuns.id, runId))
    .returning({ id: simulationRuns.id, name: simulationRuns.name });
  if (!deleted) throw new HttpError(404, `Run ${runId} not found`);
  return deleted;
}
