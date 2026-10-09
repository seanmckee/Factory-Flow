import { MinHeap, keyOrdinal, keyTick, scheduleKey } from "./minHeap.js";
import {
  setupKey,
  type ScrappedPart,
  type SetupStart,
  type TickWorkCenterMetrics,
} from "./observations.js";
import {
  PROCESS_TIME_DEVIATION,
  sampleProcessTime,
  unitDraw,
} from "./sampleProcessTime.js";
import type {
  FinishedPart,
  Routing,
  RoutingStep,
  WipPart,
  WorkCenter,
} from "./types.js";

/**
 * The shop floor as an **event queue** rather than a loop over simulated
 * seconds.
 *
 * The rules are the tick-stepped engine's, unchanged — a center runs up to
 * `capacity` parts at once, waiting parts are admitted in WIP-list order, a
 * changeover is paid once per (work order, step) by whichever unit reaches a
 * machine first, and a scrap draw happens at step completion with the machine
 * time already spent. What changed is that nothing is recomputed on a tick
 * where nothing happens. A part in process is a single scheduled completion,
 * not 90 iterations that each clone it; a staffed day over a floor of 865
 * parts was ~25M part-tick iterations and is now a few thousand events.
 *
 * Three things make that substitution exact rather than approximate, and each
 * is a decision made long before this file:
 *
 * - **Draws do not depend on event order.** `sampleProcessTime` is keyed on
 *   `(seed, workOrderId, unitIndex, stepIndex)` with no cursor, so a part's
 *   process time and its scrap fate are the same numbers whatever order the
 *   engine reaches them in. An engine that drew from a stream could not be
 *   rewritten this way at all.
 * - **Admission order is list order**, and list order is fixed for the life of
 *   a batch — releases are grafted on between batches, never during one. So a
 *   part's index in the opening WIP list is a stable **ordinal**, and every
 *   queue here is ordered by it. That is the whole of the tie-break.
 * - **Everything observable between two events is constant.** Occupancy, queue
 *   depth and WIP only move when a part is admitted or completes, so a quiet
 *   stretch is one observation with a span rather than a row per second.
 *
 * The one arithmetic trap is the boundary. A part admitted at tick `t` has its
 * progress incremented *within* that tick, so a one-second step admitted at
 * `t` completes at `t`, and in general `completesAtTick = t + actual − 1`.
 * Reading it as `t + actual` shifts every completion in the run by a second,
 * which is small enough to look like noise and large enough to change what a
 * fork comparison says.
 */

/**
 * One part on the floor. Mutable and private to the engine: the batch gets
 * `WipPart`s back out of `survivors`, built fresh.
 *
 * `progressSeconds` is deliberately **absent** — it is the field the tick loop
 * existed to increment. A part in process is described by the tick it finishes
 * on, and progress is recovered from that only when someone asks
 * (`survivors`), which is once per batch rather than once per second.
 */
type Slot = {
  readonly id: string;
  readonly workOrderId: number;
  readonly unitIndex: number;
  readonly releasedAtTick: number;
  /** position in the opening WIP list: admission order, and the heap tie-break */
  readonly ordinal: number;
  /** this work order's pinned steps */
  readonly steps: RoutingStep[];
  readonly materialCostCents: number;
  stepIndex: number;
  /** this step's process time for this part, setup folded in if it paid one */
  actualProcessTimeSeconds: number;
  /** the tick this part's current step completes on; -1 while it waits */
  completesAtTick: number;
  /** false once it has finished, scrapped, or left stranded */
  onFloor: boolean;
  /** past the end of a routing shortened under it: finishes holding no machine */
  stranded: boolean;
};

/**
 * One stretch of ticks the floor could not tell apart, and the events that
 * opened it.
 *
 * The events happened on `tickNum`; `quietThrough` is the last tick whose
 * observations are identical to it. A caller that wants a row per tick repeats
 * the observation across the span — which is what `simulateBatch` does, and
 * what keeps the stored series byte-identical to the tick loop's.
 *
 * `workCenters` is **shared** across the span rather than copied per tick, so
 * a quiet hour allocates one array instead of 3,600. Treat it as frozen.
 */
export type FloorSegment = {
  tickNum: number;
  quietThrough: number;
  /** parts left on the floor at the end of `tickNum` */
  wipCount: number;
  /** their material value, maintained as parts leave rather than re-summed */
  wipMaterialCents: number;
  workCenters: TickWorkCenterMetrics[];
  /** completed at `tickNum`, in list order */
  finished: FinishedPart[];
  /** ruined at `tickNum`, in list order */
  scrapped: ScrappedPart[];
  /** changeovers that began at `tickNum`, in list order */
  setupsStarted: SetupStart[];
};

export type FloorEngineInput = {
  wipParts: WipPart[];
  /** keyed by work order id: each release pinned its own copy of the steps */
  routingByWorkOrder: Map<number, Routing>;
  workCenters: Map<number, WorkCenter>;
  rngSeed: number;
  /** (work order, step) pairs whose changeover is already paid */
  setupDone: ReadonlySet<string>;
  /** work order id -> the material cost of the part it makes */
  materialCostByWorkOrder: Map<number, number>;
  /** ticks already advanced; the batch's first tick is `startTick + 1` */
  startTick: number;
};

export class FloorEngine {
  private readonly slots: Slot[] = [];
  private readonly workCenters: Map<number, WorkCenter>;
  private readonly rngSeed: number;
  private readonly startTick: number;
  /** work center id -> ordinals waiting there, lowest admitted first */
  private readonly queues = new Map<number, MinHeap>();
  /** work center id -> machines occupied */
  private readonly inUse = new Map<number, number>();
  /** `(tick, ordinal)` keys: popping gives the earliest, then the lowest */
  private readonly schedule = new MinHeap();
  /** advanced as changeovers are paid; the batch freezes it afterwards */
  readonly setupDone: Set<string>;
  private wipCount = 0;
  private wipMaterialCents = 0;

  constructor(input: FloorEngineInput) {
    this.workCenters = input.workCenters;
    this.rngSeed = input.rngSeed;
    this.startTick = input.startTick;
    this.setupDone = new Set(input.setupDone);

    for (const [ordinal, source] of input.wipParts.entries()) {
      const routing = input.routingByWorkOrder.get(source.workOrderId);
      if (!routing) {
        throw new Error(
          `Part ${source.id} has no pinned routing for work order ${source.workOrderId}`,
        );
      }
      const materialCostCents = input.materialCostByWorkOrder.get(source.workOrderId);
      if (materialCostCents === undefined) {
        throw new Error(
          `Part ${source.id} belongs to work order ${source.workOrderId}, which was not loaded`,
        );
      }

      const step = routing.steps[source.stepIndex];
      const slot: Slot = {
        id: source.id,
        workOrderId: source.workOrderId,
        unitIndex: source.unitIndex,
        releasedAtTick: source.releasedAtTick,
        ordinal,
        steps: routing.steps,
        materialCostCents,
        stepIndex: source.stepIndex,
        actualProcessTimeSeconds: source.actualProcessTimeSeconds,
        completesAtTick: -1,
        onFloor: true,
        // the routing was shortened under this part: the work it was queued
        // for no longer exists, so it leaves on the batch's first tick rather
        // than freezing or vanishing — and holds no machine on the way out
        stranded: step === undefined,
      };
      this.slots.push(slot);
      this.wipCount += 1;
      this.wipMaterialCents += materialCostCents;
      if (!step) continue;

      // a center a part stands at must be loaded whether or not it is working
      this.centerFor(slot, step.workCenterId);

      if (source.progressSeconds > 0) {
        // Already mid-process: it holds the machine it started on, with no
        // capacity check — an opening state over its own capacity is not
        // reachable from a release, and the tick loop admitted it too.
        this.inUse.set(step.workCenterId, (this.inUse.get(step.workCenterId) ?? 0) + 1);
        this.scheduleCompletion(
          slot,
          this.startTick + source.actualProcessTimeSeconds - source.progressSeconds,
        );
      } else {
        this.queueFor(step.workCenterId).push(ordinal);
      }
    }
  }

  /**
   * Every segment of the batch, in tick order, covering `startTick + 1`
   * through `endTick` exactly once with no gaps.
   */
  *run(endTick: number): Generator<FloorSegment> {
    const openTick = this.startTick + 1;
    let tickNum = openTick;

    while (tickNum <= endTick) {
      const setupsStarted = this.admit(tickNum);
      // Occupancy is read *between* admission and completion, which is where
      // the tick loop read it: a part completing this tick held its machine
      // for all of it, and a part arriving from this tick's completions is not
      // yet queued anywhere a count can see.
      const workCenters = this.observe();
      const { finished, scrapped, completions } = this.complete(
        tickNum,
        tickNum === openTick,
      );

      // A machine freed or a part moved on, so the next tick cannot look like
      // this one; otherwise nothing can change until something already in
      // process completes. The test is **every** completion, not just the ones
      // that left the floor: a unit moving to its next step frees a machine
      // behind it and joins a queue ahead of it, and reading only `finished`
      // and `scrapped` here sleeps through exactly that tick.
      const next = completions > 0 ? tickNum + 1 : this.nextScheduledTick();

      yield {
        tickNum,
        quietThrough: Math.min(next - 1, endTick),
        wipCount: this.wipCount,
        wipMaterialCents: this.wipMaterialCents,
        workCenters,
        finished,
        scrapped,
        setupsStarted,
      };

      tickNum = next;
    }
  }

  /** The survivors as of `endTick`, in list order, with progress recovered. */
  survivors(endTick: number): WipPart[] {
    const parts: WipPart[] = [];
    for (const slot of this.slots) {
      if (!slot.onFloor) continue;
      parts.push({
        id: slot.id,
        workOrderId: slot.workOrderId,
        unitIndex: slot.unitIndex,
        releasedAtTick: slot.releasedAtTick,
        stepIndex: slot.stepIndex,
        // a waiting part has made no progress; one in process has made all the
        // seconds between now and the tick it is due to finish on
        progressSeconds:
          slot.completesAtTick < 0
            ? 0
            : slot.actualProcessTimeSeconds - (slot.completesAtTick - endTick),
        actualProcessTimeSeconds: slot.actualProcessTimeSeconds,
      });
    }
    return parts;
  }

  /**
   * Fills free machines from the waiting queues and schedules what they will
   * finish. Each center admits its own lowest ordinals, which is the same set
   * a single pass over the WIP list would have admitted; the **recording**
   * order is restored by sorting, because a changeover is charged to the first
   * unit reached in list order and two centers can admit on the same tick.
   */
  private admit(tickNum: number): SetupStart[] {
    const admitted: Slot[] = [];
    for (const workCenter of this.workCenters.values()) {
      const queue = this.queues.get(workCenter.id);
      if (!queue || queue.size === 0) continue;

      let used = this.inUse.get(workCenter.id) ?? 0;
      while (used < workCenter.capacity && queue.size > 0) {
        admitted.push(this.slotAt(queue.pop()));
        used += 1;
      }
      this.inUse.set(workCenter.id, used);
    }
    if (admitted.length === 0) return [];
    admitted.sort((a, b) => a.ordinal - b.ordinal);

    const setupsStarted: SetupStart[] = [];
    for (const slot of admitted) {
      const step = slot.steps[slot.stepIndex]!;
      if (step.setupTimeSeconds > 0) {
        const key = setupKey(slot.workOrderId, slot.stepIndex);
        if (!this.setupDone.has(key)) {
          this.setupDone.add(key);
          // machine time, not a money charge: the changeover is folded into
          // the paying unit's own process time and surfaces as rent and lost
          // constraint minutes
          slot.actualProcessTimeSeconds += step.setupTimeSeconds;
          setupsStarted.push({
            workOrderId: slot.workOrderId,
            stepIndex: slot.stepIndex,
          });
        }
      }
      this.scheduleCompletion(slot, tickNum + slot.actualProcessTimeSeconds - 1);
    }
    return setupsStarted;
  }

  /** Occupancy and queue depth per center, idle ones included. */
  private observe(): TickWorkCenterMetrics[] {
    const observations: TickWorkCenterMetrics[] = [];
    for (const workCenter of this.workCenters.values()) {
      observations.push({
        workCenterId: workCenter.id,
        busy: this.inUse.get(workCenter.id) ?? 0,
        queued: this.queues.get(workCenter.id)?.size ?? 0,
        capacity: workCenter.capacity,
      });
    }
    return observations;
  }

  /**
   * Everything due to complete on `tickNum`, lowest ordinal first. A unit
   * frees its machine, then faces its scrap draw — the machine time is spent
   * whether or not the unit survives it — then moves on, finishes, or is gone.
   */
  private complete(
    tickNum: number,
    openingTick: boolean,
  ): {
    finished: FinishedPart[];
    scrapped: ScrappedPart[];
    /** everything that left a machine, step transitions included */
    completions: number;
  } {
    const finished: FinishedPart[] = [];
    const scrapped: ScrappedPart[] = [];
    let completions = 0;

    if (openingTick) {
      for (const slot of this.slots) {
        if (!slot.stranded) continue;
        finished.push(this.finish(slot, tickNum));
        this.retire(slot);
        completions += 1;
      }
    }

    for (;;) {
      const key = this.schedule.peek();
      if (key === undefined || keyTick(key) !== tickNum) break;
      const slot = this.slotAt(keyOrdinal(this.schedule.pop()));
      completions += 1;
      const step = slot.steps[slot.stepIndex]!;
      this.inUse.set(step.workCenterId, (this.inUse.get(step.workCenterId) ?? 0) - 1);
      slot.completesAtTick = -1;

      // The quality gate sits at step completion, before anything moves, and
      // draws in its own domain so a unit's fate is independent of its process
      // time. A ruined unit never reaches the credit path: the next good unit
      // of its work order takes the sale it would have had.
      if (
        step.scrapBps > 0 &&
        unitDraw(
          {
            seed: this.rngSeed,
            workOrderId: slot.workOrderId,
            unitIndex: slot.unitIndex,
            stepIndex: slot.stepIndex,
          },
          "scrap",
        ) <
          step.scrapBps / 10_000
      ) {
        scrapped.push({
          id: slot.id,
          workOrderId: slot.workOrderId,
          unitIndex: slot.unitIndex,
          releasedAtTick: slot.releasedAtTick,
          scrappedAtTick: tickNum,
          stepIndex: slot.stepIndex,
          workCenterId: step.workCenterId,
        });
        this.retire(slot);
        continue;
      }

      const nextIndex = slot.stepIndex + 1;
      const nextStep = slot.steps[nextIndex];
      if (!nextStep) {
        finished.push(this.finish(slot, tickNum));
        this.retire(slot);
        continue;
      }

      slot.stepIndex = nextIndex;
      slot.actualProcessTimeSeconds = sampleProcessTime(
        nextStep.processTimeSeconds,
        PROCESS_TIME_DEVIATION,
        {
          seed: this.rngSeed,
          workOrderId: slot.workOrderId,
          unitIndex: slot.unitIndex,
          stepIndex: nextIndex,
        },
      );
      this.centerFor(slot, nextStep.workCenterId);
      // queued from the next tick on: admission for this one already ran, and
      // the observation above was taken before this move
      this.queueFor(nextStep.workCenterId).push(slot.ordinal);
    }

    return { finished, scrapped, completions };
  }

  private nextScheduledTick(): number {
    const key = this.schedule.peek();
    // nothing in process and nothing admittable: the floor cannot change again
    return key === undefined ? Number.POSITIVE_INFINITY : keyTick(key);
  }

  private scheduleCompletion(slot: Slot, dueAtTick: number): void {
    // a zero-second step completes on the tick it was admitted, never before it
    const completesAtTick = Math.max(dueAtTick, this.startTick + 1);
    slot.completesAtTick = completesAtTick;
    this.schedule.push(scheduleKey(completesAtTick, slot.ordinal));
  }

  private finish(slot: Slot, tickNum: number): FinishedPart {
    return {
      id: slot.id,
      workOrderId: slot.workOrderId,
      releasedAtTick: slot.releasedAtTick,
      completedAtTick: tickNum,
    };
  }

  private retire(slot: Slot): void {
    slot.onFloor = false;
    this.wipCount -= 1;
    this.wipMaterialCents -= slot.materialCostCents;
  }

  private slotAt(ordinal: number): Slot {
    const slot = this.slots[ordinal];
    if (!slot) throw new Error(`No WIP part at ordinal ${ordinal}`);
    return slot;
  }

  private queueFor(workCenterId: number): MinHeap {
    let queue = this.queues.get(workCenterId);
    if (!queue) {
      queue = new MinHeap();
      this.queues.set(workCenterId, queue);
    }
    return queue;
  }

  /** Throws the way the tick loop's `resolve` did: a corrupt run, not a zero. */
  private centerFor(slot: Slot, workCenterId: number): WorkCenter {
    const workCenter = this.workCenters.get(workCenterId);
    if (!workCenter) {
      throw new Error(
        `Part ${slot.id} is at work center ${workCenterId}, which was not loaded`,
      );
    }
    return workCenter;
  }
}
