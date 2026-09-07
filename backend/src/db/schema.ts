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
  /**
   * Machines here - not the centre's effective capacity, which is
   * `min(machines, operators)` and is computed at the load boundary. Kept
   * named `capacity` rather than renamed: the API mirrors and routing pickers
   * all speak it, and the rename buys no behaviour.
   */
  capacity: integer("capacity").notNull().default(1),
  /**
   * Operators assigned here. Gates effective capacity together with the
   * machine count, and is what the wage bill multiplies - so an operator with
   * no machine to run is paid for nothing, and a machine with nobody on it is
   * rent with no output. Both are mistakes 6E lets you make and charges for.
   */
  operators: integer("operators").notNull().default(1),
  /**
   * What **one machine** costs per calendar day whether or not it runs -
   * depreciation, maintenance, power. Per machine since 6E, so a centre's rent
   * is `machines × rate` and buying one charges its keep automatically. Live
   * value; a run freezes its own copy into `run_work_centers` at creation.
   */
  standingCostCentsPerDay: integer("standing_cost_cents_per_day")
    .notNull()
    .default(0),
  /**
   * One operator's pay per staffed hour, so the centre's bill is
   * `operators × rate` - and unlike standing cost the denominator is the
   * staffed hour, not the calendar day: a second shift doubles the day's wages
   * while amortizing the same rent, which is the entire economics of adding
   * one.
   */
  wageCentsPerHour: integer("wage_cents_per_hour").notNull().default(0),
  /** what one more machine here costs to buy, charged as a lump at purchase */
  machinePurchaseCents: integer("machine_purchase_cents").notNull().default(0),
  /**
   * What retiring a machine here returns - a negative spend on the action row.
   * Below the purchase price by design, so churning a machine costs real money
   * and the model punishes indecision rather than rewarding fiddling.
   */
  machineSalvageCents: integer("machine_salvage_cents").notNull().default(0),
  /**
   * One-off onboarding cost per operator hired here. Firing is deliberately
   * free: a crew you can shed cheaply is the temp lever, and it is what makes
   * a second shift's commitment a real comparison.
   */
  operatorHireCents: integer("operator_hire_cents").notNull().default(0),
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
  /**
   * Staffed 8-hour shifts per calendar day (1-3). A run freezes it as
   * `day_ticks = shifts × 28,800` at creation; off-shift time is not
   * simulated and not skipped-with-gaps, it simply isn't ticks.
   */
  shifts: integer("shifts").notNull().default(1),
  /**
   * Default release policy, frozen onto each run at creation like the rates:
   * `manual` (today's behaviour) | `conwip` | `due_date` | `dbr`. All five
   * policy columns are always present; only the ones the active policy reads
   * matter, so switching policies is one column flip, not a shape change.
   */
  releasePolicy: varchar("release_policy", { length: 20 })
    .notNull()
    .default("manual"),
  /** conwip: release the next order while floor WIP is below this many parts */
  wipCap: integer("wip_cap").notNull().default(200),
  /** due_date: release each order this many calendar days before it is due */
  releaseLeadDays: integer("release_lead_days").notNull().default(1),
  /**
   * dbr: the drum — the constraint the rope paces releases to. Live config,
   * so unlike every frozen copy it IS keyed, and deleting the centre nulls
   * the default rather than dangling it.
   */
  drumWorkCenterId: integer("drum_work_center_id").references(
    () => workCenters.id,
    { onDelete: "set null" },
  ),
  /** dbr: release drum-visiting orders while WIP at the drum is below this */
  drumBuffer: integer("drum_buffer").notNull().default(50),
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
    /**
     * Probability a unit is ruined at this step, in basis points (100 = 1%),
     * drawn at step completion — the machine time is spent either way. Integer
     * like the carrying rate, so the model stays exact.
     */
    scrapBps: integer("scrap_bps").notNull().default(0),
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
  /**
   * Calendar day the order is promised by: on time ⇔
   * `completedAtTick <= dueDay × day_ticks`, against the run's own frozen
   * `day_ticks` and its own clock (every run starts at tick 0). Days rather
   * than ticks deliberately — a two-shift run (6D) reads the same promise as
   * more staffed seconds, because a due date is a calendar fact, not a
   * staffing fact. Null = no promise; such units are never measured.
   */
  dueDay: integer("due_day"),
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
  /** set by `forkRun`: the run this one was copied from at `forked_at_tick` */
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
  /**
   * The run's release policy, frozen from `factory_settings` at creation and
   * changed only by `POST /api/runs/:id/policy` under the run's lock — the
   * second writer of a run's frozen config, after capital actions. A fork
   * copies these five, so re-policying a parent never reaches its forks.
   */
  releasePolicy: varchar("release_policy", { length: 20 })
    .notNull()
    .default("manual"),
  wipCap: integer("wip_cap").notNull().default(200),
  releaseLeadDays: integer("release_lead_days").notNull().default(1),
  /** un-keyed on purpose, like every frozen `work_center_id` copy */
  drumWorkCenterId: integer("drum_work_center_id"),
  drumBuffer: integer("drum_buffer").notNull().default(50),
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
    /**
     * The covering sales order's `due_day × the run's day_ticks`, frozen at
     * credit time like `unit_price_cents`. NOT null exactly when
     * `sales_order_id` is: also null when the covering order simply had no due
     * date — and `sales_order_id`'s ON DELETE SET NULL nulls the reference
     * while this stays frozen, so the OTD metric reads only this column.
     */
    dueAtTick: integer("due_at_tick"),
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

/**
 * The observation series the chart and the metrics read: **one row per
 * simulated minute**, not per tick (6G). Not recomputable — WIP is mutable
 * state, and no stored table can say what it was at tick 300 once it has moved
 * on.
 *
 * A row per tick was 220,000 rows for a 20,000-tick advance of the seeded
 * ten-centre factory, which made the write ~97% of a fast-forward's wall clock
 * and a whole-run `/metrics` on a 15-day run a 4.75M-row read taking 7.4s. A
 * row per minute is 60× fewer of both.
 *
 * **Every reported figure stays exact**, which is what makes the resolution a
 * storage choice rather than a reporting one: each column below is a sum, a
 * count or a max, and `aggregateMetrics` divides once at the end. What
 * coarsens is only *window resolution* — a window whose bounds fall mid-minute
 * covers the containing minutes, and the response says which, since the label
 * comes from the response.
 *
 * Written by an **accumulating upsert**, not an insert: an advance of a tick
 * count the width does not divide leaves a partial bucket, and the next
 * advance completes it. `simulation_runs.tick_num` is what says how far the run
 * got; `tick_count` says how much of this slot has been observed.
 */
export const runBuckets = pgTable(
  "run_buckets",
  {
    runId: integer("run_id")
      .references(() => simulationRuns.id, { onDelete: "cascade" })
      .notNull(),
    /**
     * First tick of the bucket's slot, `index × TICKS_PER_BUCKET + 1`. Ticks
     * are numbered from 1, so the first bucket of a run covers ticks 1…60.
     */
    startTick: integer("start_tick").notNull(),
    /** Ticks observed in this slot so far; below the width while it fills. */
    tickCount: integer("tick_count").notNull(),
    throughputCents: integer("throughput_cents").notNull(),
    /**
     * Standing costs + facility overhead accrued over this bucket's ticks.
     * Frozen cents, like the money on `run_finished_parts`: the P&L sums these
     * rather than re-deriving from rates, so a later rate edit (or 6E capital
     * action) cannot rewrite a finished run's expenses.
     */
    operatingExpenseCents: integer("operating_expense_cents")
      .notNull()
      .default(0),
    /** holding charge on each tick's end-of-tick WIP, separately reported */
    carryingCostCents: integer("carrying_cost_cents").notNull().default(0),
    /**
     * Operator pay accrued over this bucket, frozen like the other two. Its own
     * column rather than folded into expense: the wages-vs-rent split is what
     * a shift decision is about, and pre-6D ticks read 0 — nobody was paid.
     */
    wageCents: integer("wage_cents").notNull().default(0),
    /**
     * Σ parts on the floor across this bucket's ticks — the mean-WIP numerator.
     * WIP takes three columns where money takes one because it is a **level,
     * not a flow**: a mean needs this sum, a peak needs `max_wip`, and neither
     * can be recovered from `end_wip`.
     */
    wipPartTicks: integer("wip_part_ticks").notNull().default(0),
    maxWip: integer("max_wip").notNull().default(0),
    /** Parts on the floor at the bucket's last observed tick. */
    endWip: integer("end_wip").notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.startTick] })],
);

/**
 * What each work center did over a bucket, one row per center **including idle
 * ones**: utilization divides by the centre's own observed ticks, so a gap
 * would report it idle for time it wasn't watched. `busy_machine_ticks` counts
 * machine-ticks, not parts.
 *
 * `capacity_ticks` is the utilization denominator and is **not null**: it is
 * summed per observation, because 6E moves capacity mid-run and a bucket is 60
 * ticks wide. The pre-6E null that `run_tick_work_centers.capacity` carried was
 * resolved by the migration — such runs could not change capacity at all, so
 * the run's frozen effective capacity is what it was throughout — which is why
 * there is no fallback left to apply at read time.
 */
export const runBucketWorkCenters = pgTable(
  "run_bucket_work_centers",
  {
    runId: integer("run_id").notNull(),
    startTick: integer("start_tick").notNull(),
    /** un-keyed on purpose: see the note above `runWorkOrderSteps` */
    workCenterId: integer("work_center_id").notNull(),
    /** ticks in this bucket that observed this center at all */
    observedTicks: integer("observed_ticks").notNull(),
    busyMachineTicks: integer("busy_machine_ticks").notNull(),
    capacityTicks: integer("capacity_ticks").notNull(),
    /** Σ parts that wanted a machine here and didn't get one */
    queuedPartTicks: integer("queued_part_ticks").notNull(),
    /** the worst single tick in the bucket — a sum cannot recover a peak */
    maxQueueDepth: integer("max_queue_depth").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.runId, table.startTick, table.workCenterId],
    }),
    // named explicitly: drizzle-kit gives a composite key a random suffix that
    // churns on every regeneration
    foreignKey({
      name: "run_bucket_work_centers_run_id_start_tick_run_buckets_fkey",
      columns: [table.runId, table.startTick],
      foreignColumns: [runBuckets.runId, runBuckets.startTick],
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
 * Work-center config as it stood when the run was created, copied for every
 * centre in the factory. The engine reads capacity from here and never from
 * `work_centers`, which is what lets two runs disagree about the drill press:
 * change it in one run without touching the other, or the finished history of
 * either.
 *
 * Since 6E these rows are the one part of a run's frozen config that can
 * change while it lives, and only through a capital action, which charges for
 * the change and records it in `run_capital_actions`. The two
 * `*_effective_from_tick` columns are what keeps the accrual exact across such
 * a change: a per-day rate accrues `floor((t−t₀)·r/D) − floor((t−1−t₀)·r/D)`,
 * so each segment charges exactly the floor of its own duration. They are
 * **per rate** rather than one per row, so only the rate that actually changed
 * re-phases — hiring at the drill press must not perturb its rent stream, nor
 * any other centre's.
 */
export const runWorkCenters = pgTable(
  "run_work_centers",
  {
    runId: integer("run_id")
      .references(() => simulationRuns.id, { onDelete: "cascade" })
      .notNull(),
    /** un-keyed on purpose: see the note above `runWorkOrderSteps` */
    workCenterId: integer("work_center_id").notNull(),
    /** machines; effective capacity is `min(capacity, operators)` */
    capacity: integer("capacity").notNull(),
    /** frozen copy of `work_centers.operators`, then bought and sold */
    operators: integer("operators").notNull().default(1),
    /** frozen copy of `work_centers.standing_cost_cents_per_day`, per machine */
    standingCostCentsPerDay: integer("standing_cost_cents_per_day")
      .notNull()
      .default(0),
    /** frozen copy of `work_centers.wage_cents_per_hour` (per operator) */
    wageCentsPerHour: integer("wage_cents_per_hour").notNull().default(0),
    /**
     * The tick this centre's standing rate took effect — 0 for a run that has
     * never bought or retired a machine here, which is every pre-6E run and so
     * exactly the old arithmetic.
     */
    standingCostEffectiveFromTick: integer("standing_cost_effective_from_tick")
      .notNull()
      .default(0),
    /** the same, for the wage rate: moved by hiring and firing, not by machines */
    wageEffectiveFromTick: integer("wage_effective_from_tick")
      .notNull()
      .default(0),
    /** frozen prices, so an action charges what the run was created against */
    machinePurchaseCents: integer("machine_purchase_cents")
      .notNull()
      .default(0),
    machineSalvageCents: integer("machine_salvage_cents").notNull().default(0),
    operatorHireCents: integer("operator_hire_cents").notNull().default(0),
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
 * `work_center_id` here and in `run_work_centers` / `run_bucket_work_centers` is
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
    /** pinned like the process time; pre-6C releases read 0 — no changeover */
    setupTimeSeconds: integer("setup_time_seconds").notNull().default(0),
    /** pinned scrap probability in basis points; pre-6C releases read 0 */
    scrapBps: integer("scrap_bps").notNull().default(0),
    /**
     * When this (work order, step)'s one changeover started — null until the
     * first unit is admitted to a machine here, then frozen. Mutable state
     * beside pinned config, as `tick_num` and `carry_remainder` are on
     * `simulation_runs`: whether setup has been paid must survive a batch
     * boundary, and deriving it means consulting WIP, finished *and* scrapped
     * rows together (the paying unit may scrap out of the very step it set up).
     */
    setupStartedAtTick: integer("setup_started_at_tick"),
  },
  (table) => [
    primaryKey({
      columns: [table.runId, table.workOrderId, table.sequence],
    }),
  ],
);

/**
 * Units ruined by a scrap draw, append-only, with the material they consumed
 * frozen at scrap time — the same freeze-at-the-moment rule as
 * `run_finished_parts`. Deliberately its own table rather than a flag there:
 * every reader of the finished table — the `GROUP BY` that is the allocation
 * cursor, cycle time, on-time delivery, the per-order deliveries, the
 * summary's sums — depends on "finished = credited", and a flag would put a
 * load-bearing `WHERE` in all of them. A scrapped unit consumes no allocation:
 * the next good unit takes its sale, so a short work order under-delivers.
 *
 * `sequence` is the 0-based step the unit failed at; `work_center_id` is
 * frozen at scrap time and un-keyed, like every observation of a centre.
 */
export const runScrappedParts = pgTable(
  "run_scrapped_parts",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .references(() => simulationRuns.id, { onDelete: "cascade" })
      .notNull(),
    partUuid: uuid("part_uuid").notNull(),
    workOrderId: integer("work_order_id")
      .references(() => workOrders.id, { onDelete: "restrict" })
      .notNull(),
    unitIndex: integer("unit_index").notNull(),
    releasedAtTick: integer("released_at_tick").notNull(),
    scrappedAtTick: integer("scrapped_at_tick").notNull(),
    sequence: integer("sequence").notNull(),
    workCenterId: integer("work_center_id").notNull(),
    materialCostCents: integer("material_cost_cents").notNull(),
  },
  (table) => [
    unique().on(table.runId, table.partUuid),
    index("run_scrapped_parts_run_id_scrapped_at_tick_id_idx").on(
      table.runId,
      table.scrappedAtTick,
      table.id,
    ),
  ],
);

/**
 * Capital actions applied to a run — buying and retiring machines, hiring and
 * firing operators — append-only, with the money frozen at the tick applied,
 * the same rule as `run_finished_parts` and `run_scrapped_parts`: editing a
 * price afterwards must not rewrite what a run paid.
 *
 * `spend_cents` is **signed**: salvage from a retirement is a negative spend,
 * so the P&L's capital line is one sum over one column. `machines_after` and
 * `operators_after` freeze the config the action produced, so the log reads
 * without replaying deltas against the current row.
 *
 * The action is effective from `applied_at_tick + 1` — it is applied between
 * advances, under the run's lock, so a batch never spans one and the engine
 * still sees one rate per batch.
 */
export const runCapitalActions = pgTable(
  "run_capital_actions",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .references(() => simulationRuns.id, { onDelete: "cascade" })
      .notNull(),
    /** `buy_machine` | `retire_machine` | `hire_operator` | `fire_operator` */
    kind: varchar("kind", { length: 30 }).notNull(),
    /** un-keyed on purpose: see the note above `runWorkOrderSteps` */
    workCenterId: integer("work_center_id").notNull(),
    /** the run's tick when it was applied; the change bites the tick after */
    appliedAtTick: integer("applied_at_tick").notNull(),
    /** frozen; positive is money out, negative is salvage coming back */
    spendCents: integer("spend_cents").notNull(),
    machinesAfter: integer("machines_after").notNull(),
    operatorsAfter: integer("operators_after").notNull(),
  },
  (table) => [
    index("run_capital_actions_run_id_applied_at_tick_id_idx").on(
      table.runId,
      table.appliedAtTick,
      table.id,
    ),
  ],
);
