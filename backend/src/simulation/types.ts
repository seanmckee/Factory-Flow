/**
 * The simulation engine's inputs, as narrow structural types: each carries only
 * the fields the engine actually reads. Drizzle rows and API payloads are wider
 * than these and satisfy them structurally, so a run service can pass query
 * results straight in without mapping, while a test can build a work center
 * from two fields instead of ten.
 *
 * These are deliberately not the table shapes. Where the two disagree the
 * comment says why.
 */

/** A part on the shop floor, mid-route. Persisted as `run_wip_parts`. */
export type WipPart = {
  /**
   * uuid, unique within a run. Row identity only — it is deliberately not an
   * input to any draw, since a fresh uuid per release would mean the seed did
   * not determine the run.
   */
  id: string;
  workOrderId: number;
  /**
   * 0-based position within its work order's quantity, and half of this part's
   * draw key. Stored, because it has to survive a reload for the run to stay
   * reproducible.
   */
  unitIndex: number;
  /**
   * The tick this part was released onto the floor, carried for the whole of
   * its life so that cycle time is `completedAtTick - releasedAtTick`.
   *
   * Every part of a work order is instantiated at one release, so this equals
   * a per-work-order release tick today and could have lived on the run's
   * released-orders row instead. It is on the part because that survives batch
   * splitting and per-part release, and keeps cycle time out of a join.
   */
  releasedAtTick: number;
  /** 0-based position in the routing's steps, in sequence order */
  stepIndex: number;
  progressSeconds: number;
  /** this step's process time for this part, drawn once when the step begins */
  actualProcessTimeSeconds: number;
};

/**
 * A part that has completed its last step. Persisted as `run_finished_parts`,
 * a separate table, and separate here too: the frontend engine expressed this
 * as a WipPart carrying `stepIndex: -1` and an optional `completedAtTick`,
 * which made "finished" a sentinel the type system couldn't see. Progress and
 * step index are meaningless once a part is done, so they are gone.
 */
export type FinishedPart = {
  id: string;
  workOrderId: number;
  /** carried through from the `WipPart` this was; see the note there */
  releasedAtTick: number;
  completedAtTick: number;
};

/**
 * One operation. The engine identifies a step by its position in `steps`, not
 * by the `sequence` column — `PUT /api/routings/:id/steps` renumbers sequences
 * from array order, so the two agree by construction.
 */
export type RoutingStep = {
  workCenterId: number;
  processTimeSeconds: number;
  /**
   * The changeover before the work order's first unit at this step, paid once
   * per (work order, step) by whichever unit is admitted to a machine first —
   * folded into that unit's `actualProcessTimeSeconds`. Deterministic, no
   * draw: process variance is the variance that drives starve/block, and a
   * noisy setup would only buy a second RNG domain to maintain. Zero means no
   * changeover, and is never recorded as one.
   */
  setupTimeSeconds: number;
  /**
   * Probability a unit is ruined on completing this step, in basis points
   * (100 = 1%). Drawn in the RNG's scrap domain, so a unit's fate is
   * independent of its process time; the machine time is spent either way,
   * which is what makes scrap at the constraint the expensive kind.
   */
  scrapBps: number;
};

/**
 * Steps in sequence order, as pinned for one work order at release. Keyed by
 * **work order id** where the engine holds a Map: a routing edit only affects
 * releases made after it, so two work orders on the same routing can be
 * following different step lists at the same time.
 */
export type Routing = {
  steps: RoutingStep[];
};

/** `capacity` is how many parts the center can process at once. */
export type WorkCenter = {
  id: number;
  capacity: number;
};

/** Only the link to the part, for the material cost of what it produces. */
export type WorkOrder = {
  id: number;
  partId: number;
};

export type Part = {
  id: number;
  materialCostCents: number;
};

export type SalesOrder = {
  id: number;
  unitPriceCents: number;
  /**
   * The promise in the run's own ticks — `due_day × the run's day_ticks`,
   * converted at the load boundary (`loadRunState`), so the engine never sees
   * calendar days. Null = no due date; units credited to such an order are
   * never measured for on-time delivery. Required-nullable rather than
   * optional: an optional field would leak `| undefined` into every credit
   * under `exactOptionalPropertyTypes`, and `undefined` has no business in a
   * frozen row shape.
   */
  dueAtTick: number | null;
};

/**
 * Flat, as it is in the `allocations` table. The frontend types nest these
 * under their sales order because `GET /api/sales-orders` groups them for
 * display; throughput immediately un-nests them again to index by work order.
 * `id` order is load-bearing: it decides which sales order a unit is credited
 * to, which is why allocations for a work order are inserted in one statement.
 */
export type Allocation = {
  id: number;
  salesOrderId: number;
  workOrderId: number;
  quantity: number;
};
