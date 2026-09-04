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
  /**
   * What the centre costs per calendar day whether or not it runs -
   * depreciation, maintenance, power. Live value; a run freezes its own copy
   * into `run_work_centers` at creation, like capacity.
   */
  standingCostCentsPerDay: integer("standing_cost_cents_per_day")
    .notNull()
    .default(0),
});

/**
 * Facility-level cost rates - the live factory's, frozen onto each run at
 * creation. A singleton: the app always reads and writes the id=1 row,
 * upserted with the column defaults on first read. Facility-scoped settings
 * that later tracks add (shift calendar, default penalties) belong here too.
 */
export const factorySettings = pgTable("factory_settings", {
  id: integer("id").primaryKey(),
  /** rent, utilities - the cost of the doors being open, per calendar day */
  facilityOverheadCentsPerDay: integer("facility_overhead_cents_per_day")
    .notNull()
    .default(0),
  /**
   * Holding charge on the material value sitting on the floor, in basis
   * points per calendar day (100 = 1%/day), so the money model stays integer.
   */
  wipCarryingBpsPerDay: integer("wip_carrying_bps_per_day")
    .notNull()
    .default(0),
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
  /**
   * Ticks in this run's calendar day, frozen at creation (one 8-hour shift of
   * one-second ticks today; a second shift is a longer day, not a
   * reinterpretation). Frozen because expense accrual is a function of
   * `tick_num / day_ticks` - moving it under a half-advanced run would change
   * the slope of money already promised deterministic.
   */
  dayTicks: integer("day_ticks").notNull().default(28800),
  /** frozen copy of `factory_settings.facility_overhead_cents_per_day` */
  facilityOverheadCentsPerDay: integer("facility_overhead_cents_per_day")
    .notNull()
    .default(0),
  /** frozen copy of `factory_settings.wip_carrying_bps_per_day` */
  wipCarryingBpsPerDay: integer("wip_carrying_bps_per_day")
    .notNull()
    .default(0),
  /**
   * Carrying cost's sub-cent remainder, carried across advances the way
   * `tick_num` is - the one accumulator time-based expense doesn't need,
   * because carrying depends on what sat on the floor each tick. Always in
   * [0, 10000 * day_ticks), which is at most 2.88e8 and fits int4.
   */
  carryRemainder: integer("carry_remainder").notNull().default(0),
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
    /** the engine's `WipPart.id` — row identity, not a draw key */
    partUuid: uuid("part_uuid").notNull(),
    workOrderId: integer("work_order_id")
      .references(() => workOrders.id, { onDelete: "restrict" })
      .notNull(),
    /**
     * 0-based position within its work order's quantity, and half the part's
     * draw key — so it has to survive a reload for the run to replay. The
     * unique constraint below is what makes the key name one part: a work
     * order is released into a run at most once.
     */
    unitIndex: integer("unit_index").notNull(),
    releasedAtTick: integer("released_at_tick").notNull(),
    stepIndex: integer("step_index").notNull(),
    progressSeconds: integer("progress_seconds").notNull().default(0),
    actualProcessTimeSeconds: integer("actual_process_time_seconds").notNull(),
  },
  (table) => [
    unique().on(table.runId, table.partUuid),
    unique().on(table.runId, table.workOrderId, table.unitIndex),
  ],
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
    /**
     * Standing costs + facility overhead accrued this tick. Frozen cents, like
     * the money on `run_finished_parts`: the P&L sums these rather than
     * re-deriving from rates, so a later rate edit (or 6E capital action)
     * cannot rewrite a finished run's expenses.
     */
    operatingExpenseCents: integer("operating_expense_cents")
      .notNull()
      .default(0),
    /** holding charge on the tick's end-of-tick WIP, separately reported */
    carryingCostCents: integer("carrying_cost_cents").notNull().default(0),
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
    /** frozen copy of `work_centers.standing_cost_cents_per_day` */
    standingCostCentsPerDay: integer("standing_cost_cents_per_day")
      .notNull()
      .default(0),
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
