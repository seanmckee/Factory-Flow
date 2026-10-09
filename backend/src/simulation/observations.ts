/**
 * What the floor was observed doing, tick by tick.
 *
 * These shapes outlived the tick-stepped loop that first emitted them: the
 * engine is event-driven now (`floorEngine.ts`), and a stretch of ticks with
 * no event shares one observation rather than recomputing it — but what is
 * *observed* is unchanged, because it has to be. These are the rows
 * `run_buckets` stores and `metrics.ts` aggregates, and a run's history must
 * read the same whatever advanced it.
 */

/**
 * What one work center did during one tick. The engine's admission pass
 * already decides this; it used to be computed and thrown away, and the
 * frontend re-derived a worse version of it from the post-tick part list.
 *
 * That snapshot cannot be recovered afterwards: a part that finished this tick
 * held a machine for the whole of it and is gone from `wipParts` by the time
 * anyone looks, so a centre's busiest ticks are exactly the ones a snapshot
 * undercounts. Emitting it where occupancy is decided keeps the rules in one
 * place — and is why `busy` counts the part that completed *during* the tick.
 */
export type TickWorkCenterMetrics = {
  workCenterId: number;
  /**
   * Machines occupied this tick, not parts — the same number while a part
   * occupies one machine, but it is what divides by `capacity` to give
   * utilization, so it is counted as machines.
   */
  busy: number;
  /**
   * Parts whose current step is at this center but which claimed no machine:
   * queue depth, measured rather than inferred. Queueing has no data structure
   * in the engine, so this is the only place it is visible.
   */
  queued: number;
  /**
   * The effective capacity this tick admitted against — the observation's own
   * denominator. Emitted rather than read live because 6E's capital actions
   * make capacity a thing that moves mid-run: a window spanning a purchase
   * would otherwise divide the ticks *before* it by the machine count after
   * it, and report the constraint half as busy in exactly the window someone
   * opens to judge the purchase.
   */
  capacity: number;
};

/**
 * One tick's observations, the raw material `metrics.ts` aggregates. The
 * engine emits one of these per *distinct* floor state and the batch repeats
 * it across the ticks that share it, so a quiet hour costs one of these rather
 * than 3,600 — but a reader of the stored series cannot tell, which is the
 * point.
 */
export type TickMetrics = {
  /**
   * The tick these observations are of. Redundant with the argument the caller
   * passed in, and carried anyway so the record is self-describing: a batch of
   * 500 of these is collected, stored and read back as rows keyed by tick, and
   * nothing has to zip it against a separate list of tick numbers to do it.
   */
  tickNum: number;
  /**
   * Parts still on the floor at the end of the tick. Equal to
   * `wipParts.length`, and reported anyway because WIP is mutable state: once
   * a run has advanced, no stored table can say what it was at tick 300.
   */
  wipCount: number;
  /**
   * One entry per work center passed in, including centers that sat idle — a
   * centre at 0/0 is an observation, not an absence, and it costs the same to
   * own either way. Aggregations downstream depend on the denominator not
   * moving as centers drop in and out of the series.
   */
  workCenters: TickWorkCenterMetrics[];
};

/**
 * A changeover that began this tick: the first unit of `workOrderId` was
 * admitted to a machine at step `stepIndex` and its process time absorbed the
 * step's setup time. The caller marks the pair done so it is never paid again.
 */
export type SetupStart = {
  workOrderId: number;
  stepIndex: number;
};

/** The key `setupDone` speaks: one changeover per (work order, step). */
export function setupKey(workOrderId: number, stepIndex: number): string {
  return `${workOrderId}:${stepIndex}`;
}

/**
 * A unit ruined by its scrap draw on completing a step. It held its machine
 * for the whole of the step — `busy` counted it — and leaves the floor on the
 * tick it completed; it never reaches the credit path, so the next good unit of its work
 * order takes the sales order it would have had. `stepIndex` and
 * `workCenterId` say where the loss happened, frozen here because the pinned
 * steps are the run's own and observations must outlive nothing — but a
 * reader of the stored row shouldn't need the join.
 */
export type ScrappedPart = {
  id: string;
  workOrderId: number;
  unitIndex: number;
  releasedAtTick: number;
  scrappedAtTick: number;
  stepIndex: number;
  workCenterId: number;
};

