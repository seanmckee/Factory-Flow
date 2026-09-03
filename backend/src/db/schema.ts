import {
  integer,
  pgTable,
  varchar,
  serial,
  unique,
  uuid,
  primaryKey,
  foreignKey,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const workCenters = pgTable("work_centers", {
  id: serial("id").primaryKey(),
  // unique like parts.part_number - two identically named centers are
  // indistinguishable on the simulator grid and in routing step pickers
  name: varchar("name", { length: 255 }).notNull().unique(),
  capacity: integer("capacity").notNull().default(1),
});

export const parts = pgTable("parts", {
  id: serial("id").primaryKey(),
  partNumber: varchar("part_number", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  materialCostCents: integer("material_cost_cents").notNull().default(0),
});

export const routings = pgTable("routings", {
  id: serial("id").primaryKey(),
  partId: integer("part_id")
    .references(() => parts.id, { onDelete: "cascade" })
    .notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  revision: varchar("revision", { length: 255 }).notNull().default("A"),
});

export const routingSteps = pgTable(
  "routing_steps",
  {
    id: serial("id").primaryKey(),
    routingId: integer("routing_id")
      .references(() => routings.id, {
        onDelete: "cascade",
      })
      .notNull(),
    workCenterId: integer("work_center_id")
      .references(() => workCenters.id, {
        onDelete: "restrict",
      })
      .notNull(),
    sequence: integer("sequence").notNull(),
    processTimeSeconds: integer("process_time_seconds").notNull(),
    setupTimeSeconds: integer("setup_time_seconds").notNull(),
  },
  (table) => [unique().on(table.routingId, table.sequence)],
);

export const workOrders = pgTable("work_orders", {
  id: serial("id").primaryKey(),
  partId: integer("part_id")
    .references(() => parts.id, {
      onDelete: "restrict",
    })
    .notNull(),
  routingId: integer("routing_id")
    .references(() => routings.id, {
      onDelete: "restrict",
    })
    .notNull(),
  quantity: integer("quantity").notNull(),
  orderNumber: varchar("order_number", { length: 255 }).notNull().unique(),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
});

export const salesOrders = pgTable("sales_orders", {
  id: serial("id").primaryKey(),
  partId: integer("part_id")
    .references(() => parts.id, {
      onDelete: "restrict",
    })
    .notNull(),
  quantity: integer("quantity").notNull(),
  unitPriceCents: integer("unit_price_cents").notNull(),
  orderNumber: varchar("order_number", { length: 255 }).notNull().unique(),
});

export const allocations = pgTable(
  "allocations",
  {
    id: serial("id").primaryKey(),
    salesOrderId: integer("sales_order_id")
      .references(() => salesOrders.id, {
        onDelete: "cascade",
      })
      .notNull(),
    workOrderId: integer("work_order_id")
      .references(() => workOrders.id, {
        onDelete: "cascade",
      })
      .notNull(),
    quantity: integer("quantity").notNull(),
  },

  (table) => [unique().on(table.salesOrderId, table.workOrderId)],
);


/* ---------------------------------------------------------------------------
 * Run persistence: one run's history, below the shared factory definition
 * above. The comments here flag only what a future edit would otherwise
 * break.
 * ------------------------------------------------------------------------- */

export const simulationRuns = pgTable("simulation_runs", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  /**
   * `idle` | `advancing` — the lock `runService` takes for both advancing and
   * releasing, since advancing rewrites the WIP rows a release would have just
   * added. No `failed`: work either commits or rolls back, so a run is
   * consistent either way. A process that dies mid-batch does leave the run
   * held, and only a reset releases it.
   */
  status: varchar("status", { length: 20 }).notNull().default("idle"),
  tickNum: integer("tick_num").notNull().default(0),
  /** the whole of the run's randomness; the draw needs no cursor */
  rngSeed: integer("rng_seed").notNull(),
  /** reserved for forking a run at a checkpoint; nothing sets it today */
  parentRunId: integer("parent_run_id").references(
    (): AnyPgColumn => simulationRuns.id,
    { onDelete: "restrict" },
  ),
  forkedAtTick: integer("forked_at_tick"),
});

/**
 * Parts on the floor: updated as one advances, deleted when it finishes.
 * Deliberately carries neither `work_center_id` (derived from the routing the
 * engine already holds in a Map) nor `routing_id` (on the work order, RESTRICT).
 */
export const runWipParts = pgTable(
  "run_wip_parts",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .references(() => simulationRuns.id, { onDelete: "cascade" })
      .notNull(),
    /** the engine's `WipPart.id`, and a draw key */
    partUuid: uuid("part_uuid").notNull(),
    workOrderId: integer("work_order_id")
      .references(() => workOrders.id, { onDelete: "restrict" })
      .notNull(),
    releasedAtTick: integer("released_at_tick").notNull(),
    stepIndex: integer("step_index").notNull(),
    progressSeconds: integer("progress_seconds").notNull().default(0),
    actualProcessTimeSeconds: integer("actual_process_time_seconds").notNull(),
  },
  (table) => [unique().on(table.runId, table.partUuid)],
);

/**
 * Append-only. The money columns are **frozen at finish time**, not recomputed:
 * allocations cascade away with their sales order, and `calculateThroughput`
 * credits an uncovered unit zero, so recomputing would let deleting a sales
 * order rewrite a finished run's chart. Read in `(completed_at_tick, id)`
 * order — a tick finishes several parts at once, at different prices.
 */
export const runFinishedParts = pgTable(
  "run_finished_parts",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .references(() => simulationRuns.id, { onDelete: "cascade" })
      .notNull(),
    partUuid: uuid("part_uuid").notNull(),
    workOrderId: integer("work_order_id")
      .references(() => workOrders.id, { onDelete: "restrict" })
      .notNull(),
    releasedAtTick: integer("released_at_tick").notNull(),
    completedAtTick: integer("completed_at_tick").notNull(),
    /** `unit_price_cents - material_cost_cents`, or 0 for an uncovered unit */
    throughputCents: integer("throughput_cents").notNull(),
    /** null when the unit was uncovered — inventory, not revenue */
    salesOrderId: integer("sales_order_id").references(() => salesOrders.id, {
      onDelete: "set null",
    }),
    /** null exactly when `sales_order_id` is */
    unitPriceCents: integer("unit_price_cents"),
    materialCostCents: integer("material_cost_cents").notNull(),
  },
  (table) => [
    unique().on(table.runId, table.partUuid),
    index("run_finished_parts_run_id_completed_at_tick_id_idx").on(
      table.runId,
      table.completedAtTick,
      table.id,
    ),
  ],
);

/** The series the chart reads. Not recomputable — WIP is mutable state. */
export const runTicks = pgTable(
  "run_ticks",
  {
    runId: integer("run_id")
      .references(() => simulationRuns.id, { onDelete: "cascade" })
      .notNull(),
    tickNum: integer("tick_num").notNull(),
    throughputCents: integer("throughput_cents").notNull(),
    wipCount: integer("wip_count").notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.tickNum] })],
);

/**
 * What each work center did during a tick, one row per center **including idle
 * ones**: utilization divides by the centre's own observed ticks, so a gap
 * would report it idle for time it wasn't watched. `busy` counts machines.
 */
export const runTickWorkCenters = pgTable(
  "run_tick_work_centers",
  {
    runId: integer("run_id").notNull(),
    tickNum: integer("tick_num").notNull(),
    /** un-keyed on purpose: see the note above `runWorkOrderSteps` */
    workCenterId: integer("work_center_id").notNull(),
    busy: integer("busy").notNull(),
    /** parts that wanted a machine here and didn't get one */
    queued: integer("queued").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.runId, table.tickNum, table.workCenterId],
    }),
    // named explicitly: drizzle-kit gives a composite key a random suffix that
    // churns on every regeneration
    foreignKey({
      name: "run_tick_work_centers_run_id_tick_num_run_ticks_fkey",
      columns: [table.runId, table.tickNum],
      foreignColumns: [runTicks.runId, runTicks.tickNum],
    }).onDelete("cascade"),
  ],
);

/**
 * Which work orders a run owns. The primary key is the double-release guard
 * `releaseOrder` lacks today. No release tick here — it's on the part.
 *
 * `routing_id` / `routing_revision` record which routing the steps below were
 * copied from. Provenance only: nothing reads them to decide behaviour, and
 * `routing_revision` is a hand-typed label that `PUT /api/routings/:id/steps`
 * does not bump, so two releases can honestly disagree while both saying "A".
 */
export const runReleasedOrders = pgTable(
  "run_released_orders",
  {
    runId: integer("run_id")
      .references(() => simulationRuns.id, { onDelete: "cascade" })
      .notNull(),
    workOrderId: integer("work_order_id")
      .references(() => workOrders.id, { onDelete: "restrict" })
      .notNull(),
    routingId: integer("routing_id").notNull(),
    routingRevision: varchar("routing_revision", { length: 255 }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.workOrderId] })],
);

/**
 * Work-center capacity as it stood when the run was created, copied for every
 * centre in the factory. The engine reads capacity from here and never from
 * `work_centers`, which is what lets two runs disagree about the drill press:
 * change it in one run without touching the other, or the finished history of
 * either.
 */
export const runWorkCenters = pgTable(
  "run_work_centers",
  {
    runId: integer("run_id")
      .references(() => simulationRuns.id, { onDelete: "cascade" })
      .notNull(),
    /** un-keyed on purpose: see the note above `runWorkOrderSteps` */
    workCenterId: integer("work_center_id").notNull(),
    capacity: integer("capacity").notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.workCenterId] })],
);

/**
 * The steps a released work order follows, copied from its routing at release
 * and never touched again. Keyed by **work order**, not by routing: releasing
 * work order A pins the routing as it is now, and editing that routing
 * afterwards changes nothing for A while the next release picks up the edit.
 * Ten work orders on an unedited routing means ten identical copies of a few
 * rows, which is cheaper than any scheme that makes a part's steps ambiguous.
 *
 * Without this, `PUT /api/routings/:id/steps` re-plans parts already halfway
 * through a route, and shortening a list strands them past its end.
 *
 * `work_center_id` here and in `run_work_centers` / `run_tick_work_centers` is
 * **un-keyed** — don't add FKs. A pinned copy and a set of observations exist
 * to outlive edits to what they copied, and an FK would either erase a
 * finished run's history or add a 500 path to work-centre deletion that
 * doesn't exist today.
 */
export const runWorkOrderSteps = pgTable(
  "run_work_order_steps",
  {
    runId: integer("run_id")
      .references(() => simulationRuns.id, { onDelete: "cascade" })
      .notNull(),
    workOrderId: integer("work_order_id")
      .references(() => workOrders.id, { onDelete: "restrict" })
      .notNull(),
    /** 0-based, renumbered from array order as the live table is */
    sequence: integer("sequence").notNull(),
    workCenterId: integer("work_center_id").notNull(),
    processTimeSeconds: integer("process_time_seconds").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.runId, table.workOrderId, table.sequence],
    }),
  ],
);
