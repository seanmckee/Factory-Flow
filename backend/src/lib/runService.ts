import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  routingSteps,
  routings,
  runFinishedParts,
  runReleasedOrders,
  runTickWorkCenters,
  runTicks,
  runWipParts,
  runWorkCenters,
  runWorkOrderSteps,
  simulationRuns,
  workCenters,
  workOrders,
} from "../db/schema.js";
import {
  PROCESS_TIME_DEVIATION,
  sampleProcessTime,
} from "../simulation/sampleProcessTime.js";
import { simulateBatch } from "../simulation/simulateBatch.js";
import { HttpError } from "./httpError.js";
import { loadRunState, type RunRow } from "./runState.js";

/**
 * The write side of the run API: creating a run, releasing into it and
 * advancing it, all under the run's lock. The reads — summaries, metrics, the
 * floor, the tick series — live in `runReads.ts`, and the state loader both
 * sides share in `runState.ts`.
 */

/**
 * How many ticks are simulated per transaction. The point of advancing in
 * memory is that a fast-forward isn't a round trip per simulated second, but a
 * single unbounded transaction would hold a Neon connection for as long as the
 * whole run and lose everything on a failure — so a long advance is several
 * batches and a crash costs at most one of them.
 */
const TICKS_PER_BATCH = 500;

/**
 * Rows per insert statement. Postgres caps a statement's bind parameters near
 * 65535, and 500 ticks of a factory with twenty work centers is ten thousand
 * per-center rows, so the wide inserts have to be split.
 */
const ROWS_PER_INSERT = 1000;

function chunked<T>(rows: T[], size = ROWS_PER_INSERT): T[][] {
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

/**
 * Creates a run and freezes the factory's capacities into it. From here on the
 * run reads `run_work_centers`, never `work_centers`, so editing a centre's
 * capacity leaves this run — and every run already created — alone.
 */
export async function createRun(name: string, rngSeed: number): Promise<RunRow> {
  return db.transaction(async (tx) => {
    const [run] = await tx
      .insert(simulationRuns)
      .values({ name, rngSeed })
      .returning();
    if (!run) throw new HttpError(500, "Run insert failed");

    const centers = await tx
      .select({ id: workCenters.id, capacity: workCenters.capacity })
      .from(workCenters);

    if (centers.length > 0) {
      await tx.insert(runWorkCenters).values(
        centers.map((center) => ({
          runId: run.id,
          workCenterId: center.id,
          capacity: center.capacity,
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

      for (const slice of chunked(newParts)) {
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

    for (let remaining = ticks; remaining > 0; ) {
      const size = Math.min(remaining, TICKS_PER_BATCH);
      const batch = simulateBatch(state, size);

      await db.transaction(async (tx) => {
        // the survivors replace the stored set: after a batch nearly every
        // part has moved, and no row references a WIP part by id
        await tx.delete(runWipParts).where(eq(runWipParts.runId, runId));
        for (const slice of chunked(batch.wipParts)) {
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

        for (const slice of chunked(batch.finishedParts)) {
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
            })),
          );
        }

        for (const slice of chunked(batch.ticks)) {
          await tx.insert(runTicks).values(
            slice.map((tick) => ({
              runId,
              tickNum: tick.tickNum,
              throughputCents: tick.throughputCents,
              wipCount: tick.wipCount,
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
          })),
        );
        for (const slice of chunked(centerRows)) {
          await tx.insert(runTickWorkCenters).values(slice);
        }

        await tx
          .update(simulationRuns)
          .set({ tickNum: batch.tickNum })
          .where(eq(simulationRuns.id, runId));
      });

      throughputCents += batch.ticks.reduce(
        (sum, tick) => sum + tick.throughputCents,
        0,
      );
      state = {
        ...state,
        tickNum: batch.tickNum,
        wipParts: batch.wipParts,
        priorCounts: batch.priorCounts,
      };
      remaining -= size;
    }

    return {
      tickNum: state.tickNum,
      ticksAdvanced: ticks,
      throughputCents,
      wipCount: state.wipParts.length,
    };
  });
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
