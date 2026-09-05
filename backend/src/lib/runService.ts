import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  routingSteps,
  routings,
  runCapitalActions,
  runFinishedParts,
  runReleasedOrders,
  runScrappedParts,
  runBucketWorkCenters,
  runBuckets,
  runWipParts,
  runWorkCenters,
  runWorkOrderSteps,
  simulationRuns,
  workCenters,
  workOrders,
} from "../db/schema.js";
import { TICKS_PER_DAY } from "../simulation/operatingExpense.js";
import {
  admitOrderIntoState,
  buildReleaseParts,
} from "../simulation/releaseAdmission.js";
import {
  eligibleBacklogCount,
  planReleases,
  policyFromRun,
} from "../simulation/releasePolicy.js";
import {
  TICKS_PER_BUCKET,
  bucketMoney,
  bucketTicks,
} from "../simulation/observationBuckets.js";
import { simulateBatch } from "../simulation/simulateBatch.js";
import { getFactorySettings } from "./factorySettings.js";
import { defaultForkName } from "./forkName.js";
import { HttpError } from "./httpError.js";
import {
  loadReleaseBacklog,
  loadRunState,
  type LoadedBacklogOrder,
  type RunRow,
} from "./runState.js";

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
        // the release policy freezes like the rates: the settings row is the
        // default, POST /:id/policy is the per-run writer thereafter
        releasePolicy: settings.releasePolicy,
        wipCap: settings.wipCap,
        releaseLeadDays: settings.releaseLeadDays,
        drumWorkCenterId: settings.drumWorkCenterId,
        drumBuffer: settings.drumBuffer,
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

    // a dbr run without a drum can never release anything, so refuse the
    // creation rather than freeze a policy that silently starves the floor
    if (
      settings.releasePolicy === "dbr" &&
      (settings.drumWorkCenterId === null ||
        !centers.some((center) => center.id === settings.drumWorkCenterId))
    ) {
      throw new HttpError(
        400,
        "Factory settings use drum-buffer-rope but name no existing drum work center — pick one in Factory Settings first",
      );
    }

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

/**
 * Every payload column of an insert shape, `id` excluded — the compile-time
 * guard on `forkRun`'s copy selections. A copy that misses a column doesn't
 * fail, it silently takes the column default (nearly every `run_work_centers`
 * column has one, so a forgotten column would quietly reset a bought
 * machine); `satisfies CopyOf<…>` turns that into a build error instead.
 */
type CopyOf<TInsert> = Record<keyof Required<Omit<TInsert, "id">>, unknown>;

/**
 * Copies a run as it stands at its current tick — Track 7's checkpoint fork.
 * A fork is a **copy, not a versioning scheme**: the child gets its own rows
 * for the frozen config, the floor, the history and the observations, and the
 * shared seed plus the uuid-free draw key mean both branches draw identical
 * noise until a decision — a capital action, a release — diverges them.
 *
 * Taken under the **parent's** lock: an advance replaces the WIP rows and
 * writes the buckets in separate statements, so a fork landing mid-batch
 * would copy a torn state. The child needs no lock of its own — nobody can
 * learn its id until the transaction commits. One transaction on purpose:
 * `run_capital_actions` has no unique constraint, so a partial copy retried
 * would silently double the P&L's capital line.
 *
 * Every `run_*` table is copied, and a new one must join this list — nothing
 * catches a missed *table* automatically. A missed *column* is a compile
 * error via the `CopyOf` annotations. The parent's trailing observation
 * bucket may be partial (`tick_count < 60`); it is copied verbatim, and the
 * accumulating bucket upsert completes it when the child advances into the
 * same grid slot — the same mechanics as an advance whose length the bucket
 * width does not divide.
 */
export async function forkRun(
  parentId: number,
  name?: string,
): Promise<RunRow> {
  return withRunLock(parentId, (parent) =>
    db.transaction(async (tx) => {
      const [child] = await tx
        .insert(simulationRuns)
        .values({
          name:
            name ??
            defaultForkName(parent.name, parent.tickNum, parent.dayTicks),
          // status deliberately not copied: `parent` is the row the lock
          // claimed, so it reads `advancing` here; the child defaults to idle
          tickNum: parent.tickNum,
          rngSeed: parent.rngSeed,
          parentRunId: parent.id,
          forkedAtTick: parent.tickNum,
          dayTicks: parent.dayTicks,
          facilityOverheadCentsPerDay: parent.facilityOverheadCentsPerDay,
          wipCarryingBpsPerDay: parent.wipCarryingBpsPerDay,
          carryRemainder: parent.carryRemainder,
          // NOTE: this literal is hand-maintained — a new simulation_runs
          // column must be added here BY HAND or a fork silently takes the
          // column default (no CopyOf guard exists on this table).
          // check:policy's fork-isolation assertion is the runtime net.
          releasePolicy: parent.releasePolicy,
          wipCap: parent.wipCap,
          releaseLeadDays: parent.releaseLeadDays,
          drumWorkCenterId: parent.drumWorkCenterId,
          drumBuffer: parent.drumBuffer,
        })
        .returning();
      if (!child) throw new HttpError(500, "Fork insert failed");

      const childId = sql<number>`${child.id}::int`;

      // frozen config: capacities, rates, prices, and both effective-from
      // ticks — absolute run ticks, valid verbatim because the child keeps
      // the parent's tick numbering
      await tx.insert(runWorkCenters).select((qb) =>
        qb
          .select({
            runId: childId.as("run_id"),
            workCenterId: runWorkCenters.workCenterId,
            capacity: runWorkCenters.capacity,
            operators: runWorkCenters.operators,
            standingCostCentsPerDay: runWorkCenters.standingCostCentsPerDay,
            wageCentsPerHour: runWorkCenters.wageCentsPerHour,
            standingCostEffectiveFromTick:
              runWorkCenters.standingCostEffectiveFromTick,
            wageEffectiveFromTick: runWorkCenters.wageEffectiveFromTick,
            machinePurchaseCents: runWorkCenters.machinePurchaseCents,
            machineSalvageCents: runWorkCenters.machineSalvageCents,
            operatorHireCents: runWorkCenters.operatorHireCents,
          } satisfies CopyOf<typeof runWorkCenters.$inferInsert>)
          .from(runWorkCenters)
          .where(eq(runWorkCenters.runId, parent.id)),
      );

      // pinned steps, including the mutable setup_started_at_tick — without
      // it the child re-pays every changeover the parent already paid
      await tx.insert(runWorkOrderSteps).select((qb) =>
        qb
          .select({
            runId: childId.as("run_id"),
            workOrderId: runWorkOrderSteps.workOrderId,
            sequence: runWorkOrderSteps.sequence,
            workCenterId: runWorkOrderSteps.workCenterId,
            processTimeSeconds: runWorkOrderSteps.processTimeSeconds,
            setupTimeSeconds: runWorkOrderSteps.setupTimeSeconds,
            scrapBps: runWorkOrderSteps.scrapBps,
            setupStartedAtTick: runWorkOrderSteps.setupStartedAtTick,
          } satisfies CopyOf<typeof runWorkOrderSteps.$inferInsert>)
          .from(runWorkOrderSteps)
          .where(eq(runWorkOrderSteps.runId, parent.id)),
      );

      await tx.insert(runReleasedOrders).select((qb) =>
        qb
          .select({
            runId: childId.as("run_id"),
            workOrderId: runReleasedOrders.workOrderId,
            routingId: runReleasedOrders.routingId,
            routingRevision: runReleasedOrders.routingRevision,
          } satisfies CopyOf<typeof runReleasedOrders.$inferInsert>)
          .from(runReleasedOrders)
          .where(eq(runReleasedOrders.runId, parent.id)),
      );

      // The floor is copied through JS with an ordered multi-row insert, not
      // INSERT…SELECT: `loadRunState` reads WIP `ORDER BY id` and admission is
      // list order, so relative id order is replay-load-bearing, and serial
      // assignment order under INSERT…SELECT is not guaranteed. WIP is small
      // (peaked at 865 on the 15-day playthrough); the append-only tables
      // below stay server-side.
      const wip = await tx
        .select()
        .from(runWipParts)
        .where(eq(runWipParts.runId, parent.id))
        .orderBy(runWipParts.id);
      for (const slice of chunked(wip, chunkFor(8))) {
        await tx.insert(runWipParts).values(
          slice.map(
            (part) =>
              ({
                runId: child.id,
                partUuid: part.partUuid,
                workOrderId: part.workOrderId,
                unitIndex: part.unitIndex,
                releasedAtTick: part.releasedAtTick,
                stepIndex: part.stepIndex,
                progressSeconds: part.progressSeconds,
                actualProcessTimeSeconds: part.actualProcessTimeSeconds,
              }) satisfies CopyOf<typeof runWipParts.$inferInsert>,
          ),
        );
      }

      // history — required for correctness, not just reporting: priorCounts
      // is a GROUP BY over the finished table and is the allocation cursor
      await tx.insert(runFinishedParts).select((qb) =>
        qb
          .select({
            runId: childId.as("run_id"),
            partUuid: runFinishedParts.partUuid,
            workOrderId: runFinishedParts.workOrderId,
            releasedAtTick: runFinishedParts.releasedAtTick,
            completedAtTick: runFinishedParts.completedAtTick,
            throughputCents: runFinishedParts.throughputCents,
            salesOrderId: runFinishedParts.salesOrderId,
            unitPriceCents: runFinishedParts.unitPriceCents,
            materialCostCents: runFinishedParts.materialCostCents,
            dueAtTick: runFinishedParts.dueAtTick,
          } satisfies CopyOf<typeof runFinishedParts.$inferInsert>)
          .from(runFinishedParts)
          .where(eq(runFinishedParts.runId, parent.id))
          .orderBy(runFinishedParts.id),
      );

      await tx.insert(runScrappedParts).select((qb) =>
        qb
          .select({
            runId: childId.as("run_id"),
            partUuid: runScrappedParts.partUuid,
            workOrderId: runScrappedParts.workOrderId,
            unitIndex: runScrappedParts.unitIndex,
            releasedAtTick: runScrappedParts.releasedAtTick,
            scrappedAtTick: runScrappedParts.scrappedAtTick,
            sequence: runScrappedParts.sequence,
            workCenterId: runScrappedParts.workCenterId,
            materialCostCents: runScrappedParts.materialCostCents,
          } satisfies CopyOf<typeof runScrappedParts.$inferInsert>)
          .from(runScrappedParts)
          .where(eq(runScrappedParts.runId, parent.id))
          .orderBy(runScrappedParts.id),
      );

      // observations — buckets before their per-centre rows (composite FK)
      await tx.insert(runBuckets).select((qb) =>
        qb
          .select({
            runId: childId.as("run_id"),
            startTick: runBuckets.startTick,
            tickCount: runBuckets.tickCount,
            throughputCents: runBuckets.throughputCents,
            operatingExpenseCents: runBuckets.operatingExpenseCents,
            carryingCostCents: runBuckets.carryingCostCents,
            wageCents: runBuckets.wageCents,
            wipPartTicks: runBuckets.wipPartTicks,
            maxWip: runBuckets.maxWip,
            endWip: runBuckets.endWip,
          } satisfies CopyOf<typeof runBuckets.$inferInsert>)
          .from(runBuckets)
          .where(eq(runBuckets.runId, parent.id)),
      );

      await tx.insert(runBucketWorkCenters).select((qb) =>
        qb
          .select({
            runId: childId.as("run_id"),
            startTick: runBucketWorkCenters.startTick,
            workCenterId: runBucketWorkCenters.workCenterId,
            observedTicks: runBucketWorkCenters.observedTicks,
            busyMachineTicks: runBucketWorkCenters.busyMachineTicks,
            capacityTicks: runBucketWorkCenters.capacityTicks,
            queuedPartTicks: runBucketWorkCenters.queuedPartTicks,
            maxQueueDepth: runBucketWorkCenters.maxQueueDepth,
          } satisfies CopyOf<typeof runBucketWorkCenters.$inferInsert>)
          .from(runBucketWorkCenters)
          .where(eq(runBucketWorkCenters.runId, parent.id)),
      );

      // the child's pre-fork capital spend: without it the copied history's
      // net and the capital log would disagree with the parent over the
      // shared ticks
      await tx.insert(runCapitalActions).select((qb) =>
        qb
          .select({
            runId: childId.as("run_id"),
            kind: runCapitalActions.kind,
            workCenterId: runCapitalActions.workCenterId,
            appliedAtTick: runCapitalActions.appliedAtTick,
            spendCents: runCapitalActions.spendCents,
            machinesAfter: runCapitalActions.machinesAfter,
            operatorsAfter: runCapitalActions.operatorsAfter,
          } satisfies CopyOf<typeof runCapitalActions.$inferInsert>)
          .from(runCapitalActions)
          .where(eq(runCapitalActions.runId, parent.id))
          .orderBy(runCapitalActions.id),
      );

      return child;
    }),
  );
}

export type ReleasePolicyUpdates = {
  releasePolicy: "manual" | "conwip" | "due_date" | "dbr";
  wipCap?: number | undefined;
  releaseLeadDays?: number | undefined;
  drumWorkCenterId?: number | null | undefined;
  drumBuffer?: number | undefined;
};

/**
 * The second writer of a run's frozen config, after capital actions: changes
 * the run's own release policy under the run's lock, so it 409s mid-advance
 * exactly as an action does and is effective from the next advance —
 * `withRunLock` hands `advanceRun` a fresh row every call. Deliberately
 * unlogged: unlike a capital action it moves no money, so the P&L has nothing
 * to freeze, and the run row itself says what the current policy is. Omitted
 * fields keep the run's current values; the merged result is what validates,
 * since a kind flip can lean on numbers set earlier.
 */
export async function changeReleasePolicy(
  runId: number,
  updates: ReleasePolicyUpdates,
): Promise<RunRow> {
  return withRunLock(runId, (run) =>
    db.transaction(async (tx) => {
      const merged = {
        releasePolicy: updates.releasePolicy,
        wipCap: updates.wipCap ?? run.wipCap,
        releaseLeadDays: updates.releaseLeadDays ?? run.releaseLeadDays,
        drumWorkCenterId:
          updates.drumWorkCenterId === undefined
            ? run.drumWorkCenterId
            : updates.drumWorkCenterId,
        drumBuffer: updates.drumBuffer ?? run.drumBuffer,
      };

      if (merged.releasePolicy === "dbr") {
        if (merged.drumWorkCenterId === null) {
          throw new HttpError(
            400,
            "A drum-buffer-rope policy needs a drum work center",
          );
        }
        // against the run's own frozen centres, not the live table — the rope
        // paces a centre this run actually has
        const [drum] = await tx
          .select({ workCenterId: runWorkCenters.workCenterId })
          .from(runWorkCenters)
          .where(
            and(
              eq(runWorkCenters.runId, runId),
              eq(runWorkCenters.workCenterId, merged.drumWorkCenterId),
            ),
          );
        if (!drum) {
          throw new HttpError(
            404,
            `Run ${runId} has no work center ${merged.drumWorkCenterId} to use as the drum`,
          );
        }
      }

      const [updated] = await tx
        .update(simulationRuns)
        .set(merged)
        .where(eq(simulationRuns.id, runId))
        .returning();
      if (!updated) throw new HttpError(500, "Policy update failed");
      // the lock's finally sets the run idle right after this returns; hand
      // the caller the state it will actually observe
      return { ...updated, status: "idle" };
    }),
  );
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

      // one construction site for a release's parts, shared with the
      // auto-release path so the draw key cannot drift between the two
      const newParts = buildReleaseParts(
        run,
        workOrderId,
        workOrder.quantity,
        firstStep.processTimeSeconds,
      );

      for (const slice of chunked(newParts, chunkFor(8))) {
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
  /**
   * What the run's release policy put on the floor during this advance, in
   * release order — empty under `manual`. The same agent-visible tier as
   * `scrappedCount`: the advance already held every row.
   */
  autoReleased: { workOrderId: number; partsReleased: number; releasedAtTick: number }[];
  /**
   * Orders the policy could still release after this advance (for `due_date`
   * that excludes undated orders, which it can never release). A caller
   * jumping until the run drains stops on `wipCount === 0 && backlogCount
   * === 0` — floor empty and nothing left that could refill it. Always 0
   * under `manual`.
   */
  backlogCount: number;
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
    // The backlog is read live, once per advance request, like the demand
    // side — and not at all under manual, so a manual run pays no new reads.
    const policy = policyFromRun(run);
    let backlog: LoadedBacklogOrder[] =
      policy.kind === "manual"
        ? []
        : await loadReleaseBacklog(
            run,
            new Set(state.routingByWorkOrder.keys()),
          );
    const autoReleased: AdvanceResult["autoReleased"] = [];
    let throughputCents = 0;
    let operatingExpenseCents = 0;
    let carryingCostCents = 0;
    let wageCents = 0;
    let scrappedCount = 0;

    for (let remaining = ticks; remaining > 0; ) {
      // The policy is evaluated between batches — at the advance's start and
      // then hourly — so an order becoming eligible mid-batch releases at
      // most one batch late. Admission extends the in-memory state (the
      // parts ride the WIP replace below); the release rows join the batch's
      // own transaction, so a crash loses the batch and its releases
      // together rather than leaving a released order with no parts.
      const pendingReleases: LoadedBacklogOrder[] = [];
      if (backlog.length > 0) {
        const planned = new Set(planReleases(policy, state, backlog));
        for (const order of backlog) {
          if (!planned.has(order.workOrderId)) continue;
          const firstStep = order.steps[0];
          if (!firstStep) continue; // loader excludes stepless orders already
          const newParts = buildReleaseParts(
            { rngSeed: run.rngSeed, tickNum: state.tickNum },
            order.workOrderId,
            order.quantity,
            firstStep.processTimeSeconds,
          );
          state = admitOrderIntoState(state, order, newParts);
          pendingReleases.push(order);
          autoReleased.push({
            workOrderId: order.workOrderId,
            partsReleased: newParts.length,
            releasedAtTick: state.tickNum,
          });
        }
        if (pendingReleases.length > 0) {
          const releasedNow = new Set(
            pendingReleases.map((order) => order.workOrderId),
          );
          backlog = backlog.filter(
            (order) => !releasedNow.has(order.workOrderId),
          );
        }
      }

      const size = Math.min(remaining, TICKS_PER_BATCH);
      const batch = simulateBatch(state, size);

      await db.transaction(async (tx) => {
        // release rows first — before the WIP replace whose rows assume the
        // released order exists, and before the setup updates that target
        // run_work_order_steps
        for (const order of pendingReleases) {
          await tx.insert(runReleasedOrders).values({
            runId,
            workOrderId: order.workOrderId,
            routingId: order.routingId,
            routingRevision: order.routingRevision,
          });
          await tx.insert(runWorkOrderSteps).values(
            order.steps.map((step, sequence) => ({
              runId,
              workOrderId: order.workOrderId,
              sequence,
              workCenterId: step.workCenterId,
              processTimeSeconds: step.processTimeSeconds,
              setupTimeSeconds: step.setupTimeSeconds,
              scrapBps: step.scrapBps,
            })),
          );
        }

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

        // Observations go onto the minute grid (6G). The arithmetic is the
        // pure `bucketTicks`/`bucketMoney` pair; this only shapes rows.
        const flowBuckets = bucketTicks(batch.ticks, TICKS_PER_BUCKET);
        const moneyByStart = bucketMoney(batch.ticks, TICKS_PER_BUCKET);
        const bucketRows = flowBuckets.map((bucket) => {
          const money = moneyByStart.get(bucket.startTick);
          if (!money) {
            // the two walk the same grid over the same ticks, so a slot with
            // observations and no money is a bug in one of them, not a run
            // that earned nothing
            throw new Error(
              `Bucket at tick ${bucket.startTick} has observations but no money`,
            );
          }
          return {
            runId,
            startTick: bucket.startTick,
            tickCount: bucket.tickCount,
            throughputCents: money.throughputCents,
            operatingExpenseCents: money.operatingExpenseCents,
            carryingCostCents: money.carryingCostCents,
            wageCents: money.wageCents,
            wipPartTicks: bucket.wipPartTicks,
            maxWip: bucket.maxWip,
            endWip: bucket.endWip,
          };
        });

        // An **accumulating** upsert, not an insert: an advance of a tick count
        // 60 does not divide leaves a partial bucket that this advance's first
        // slot continues. Sums add, the peak takes the greater, and the closing
        // level is simply the newer one — batches arrive in tick order, so the
        // later batch's last tick is the bucket's last tick.
        for (const slice of chunked(bucketRows, chunkFor(10))) {
          await tx
            .insert(runBuckets)
            .values(slice)
            .onConflictDoUpdate({
              target: [runBuckets.runId, runBuckets.startTick],
              set: {
                tickCount: sql`${runBuckets.tickCount} + excluded.tick_count`,
                throughputCents: sql`${runBuckets.throughputCents} + excluded.throughput_cents`,
                operatingExpenseCents: sql`${runBuckets.operatingExpenseCents} + excluded.operating_expense_cents`,
                carryingCostCents: sql`${runBuckets.carryingCostCents} + excluded.carrying_cost_cents`,
                wageCents: sql`${runBuckets.wageCents} + excluded.wage_cents`,
                wipPartTicks: sql`${runBuckets.wipPartTicks} + excluded.wip_part_ticks`,
                maxWip: sql`greatest(${runBuckets.maxWip}, excluded.max_wip)`,
                endWip: sql`excluded.end_wip`,
              },
            });
        }

        // the per-center rows key the bucket rows above, so they go in after
        const centerRows = flowBuckets.flatMap((bucket) =>
          bucket.workCenters.map((center) => ({
            runId,
            startTick: bucket.startTick,
            workCenterId: center.workCenterId,
            observedTicks: center.observedTicks,
            busyMachineTicks: center.busyMachineTicks,
            capacityTicks: center.capacityTicks,
            queuedPartTicks: center.queuedPartTicks,
            maxQueueDepth: center.maxQueueDepth,
          })),
        );
        for (const slice of chunked(centerRows, chunkFor(8))) {
          await tx
            .insert(runBucketWorkCenters)
            .values(slice)
            .onConflictDoUpdate({
              target: [
                runBucketWorkCenters.runId,
                runBucketWorkCenters.startTick,
                runBucketWorkCenters.workCenterId,
              ],
              set: {
                observedTicks: sql`${runBucketWorkCenters.observedTicks} + excluded.observed_ticks`,
                busyMachineTicks: sql`${runBucketWorkCenters.busyMachineTicks} + excluded.busy_machine_ticks`,
                capacityTicks: sql`${runBucketWorkCenters.capacityTicks} + excluded.capacity_ticks`,
                queuedPartTicks: sql`${runBucketWorkCenters.queuedPartTicks} + excluded.queued_part_ticks`,
                maxQueueDepth: sql`greatest(${runBucketWorkCenters.maxQueueDepth}, excluded.max_queue_depth)`,
              },
            });
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
      autoReleased,
      backlogCount: eligibleBacklogCount(policy, backlog),
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
