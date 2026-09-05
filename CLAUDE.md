# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Factory Flow is a manufacturing simulation platform inspired by Goldratt's _The Goal_: it models production flow to study throughput, WIP, and bottlenecks. The domain vocabulary (throughput = money made through sales, not parts produced) drives the data model, so read `README.md` before changing simulation semantics.

## Repo layout

Two independent npm projects — no workspace/monorepo tooling. Install and run each separately; a change touching both requires two dev servers.

- `backend/` — Express 5 REST API + Drizzle ORM over Neon serverless Postgres
- `frontend/` — Vite + React 19 + Tailwind v4 + React Router; still runs its own copy of the simulation engine, deleted once the backend drives runs

## Commands

```bash
# backend (port 3000; requires backend/.env with DATABASE_URL)
cd backend
npm run dev        # tsx watch src/server.ts
npm run seed       # wipes and reseeds all tables (src/db/seed.ts)
npm run build      # tsc -> dist/
npm start          # node dist/server.js (needs a build first)
npm test           # vitest (watch)
npx vitest run     # single pass

# frontend (port 5173)
cd frontend
npm run dev
npm run build      # tsc -b && vite build
npm run lint       # eslint .
npm test           # vitest (watch)
npx vitest run                                   # single pass
npx vitest run src/simulation/simulationTick.test.ts   # single file
npx vitest run -t "capacity of 1"                # single test by name
```

Drizzle migrations live in `backend/drizzle/`; generate/apply with `npx drizzle-kit generate` / `npx drizzle-kit migrate` from `backend/` (config: `backend/drizzle.config.ts`).

## Backend conventions

- ESM with `"module": "nodenext"` — **relative imports must carry the `.js` extension** (`./db/index.js`), even though the sources are `.ts`.
- `tsconfig.json` enables `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`; array indexing and destructuring yield `T | undefined`, so seed/route code explicitly null-checks after `.returning()`.
- Each router in `src/routes/` is a default-exported `Router` mounted at `/api/<resource>` in `src/server.ts`. Sales orders and work orders expose `POST` and `DELETE /:id` alongside their GETs; work centers, parts and routings expose `POST`, `PATCH /:id` and `DELETE /:id`. Routings add `PUT /:id/steps`, the only PUT in the API: steps are replaced wholesale because `UNIQUE(routing_id, sequence)` makes an incremental reorder collide halfway through, so the handler deletes and reinserts inside a transaction and renumbers sequences from array order. Step payloads therefore never carry a `sequence`.
- `src/routes/runs.ts` is the run API, and the only router that holds no DB
  code: the service layer is split on the read/write line — `lib/runService.ts`
  owns the lock and the batched writes, `lib/runReads.ts` the summaries,
  metrics, floor and tick series, and `lib/runState.ts` the `loadRunState`
  loader both sides share — and the routes validate, map an `HttpError` onto
  its status and serialise. Routes
  are `POST /api/runs` (optionally overriding the facility-level cost rates it
  freezes), `GET /api/runs`, `GET /api/runs/:id` (with counts and the P&L:
  frozen throughput, operating expense, carrying cost, wages, capital spend,
  `netCents` — the score,
  and it can go negative), `GET /api/runs/:id/metrics?fromTick&toTick` (the
  same P&L windowed, plus `onTimeDelivery`, its per-order breakdown
  `salesOrderDelivery`, and `scrap` — count and frozen material cents,
  windowed on `scrapped_at_tick` — the summary deliberately carries no copy of
  any of these, since the whole-run `/metrics` already answers them),
  `GET /api/runs/:id/floor`, `GET /api/runs/:id/ticks?fromTick&toTick&bucket`
  (bucket groups the series server-side — money summed, WIP at bucket end,
  grid aligned to absolute ticks; `capitalSpendCents` is joined onto the
  bucket that contains the action, in JS. Observations are stored per
  simulated minute since 6G, so a bucket at or below `TICKS_PER_BUCKET`
  returns the stored resolution rather than erroring, and a larger one
  regroups on top),
  `POST /api/runs/:id/releases`, `POST /api/runs/:id/fork` (Track 7 — copies
  the run at its current tick into a new run with `parent_run_id` /
  `forked_at_tick` set, an optional `name` the only input; it takes the
  parent's lock, so it 409s mid-advance, and returns 201 with the new run
  row), `POST /api/runs/:id/policy` (RP — changes the run's own release
  policy under the lock, effective next advance; omitted numeric fields keep
  the run's current values, and a dbr change validates the drum against the
  run's own frozen centres), `POST /api/runs/:id/advance`,
  `POST /api/runs/:id/actions` and `GET /api/runs/:id/actions` (6E's capital
  actions — one endpoint with a discriminating `kind` of `buy_machine` /
  `retire_machine` / `hire_operator` / `fire_operator`, rather than four
  routes, because the agent's tool layer wants one verb it can parameterise;
  it takes the run's lock, so it 409s mid-advance exactly as a release does,
  and the money it charges is the run's **frozen** price, never the caller's
  number),
  `POST /api/runs/:id/unlock` and `DELETE /api/runs/:id`. `advance` caps
  `ticks` at `MAX_TICKS_PER_REQUEST` (20000) because advancing is synchronous
  at roughly 500 ticks a second; a caller that wants more calls again, since a
  run is resumable by construction. Its result carries the surviving
  `wipCount`, so a caller advancing until the floor is empty stops on the
  advance's own answer rather than chasing each call with a `GET /:id` that
  could already be a batch stale — it is `state.wipParts.length` after the
  last batch, not a query — and `scrappedCount`, `autoReleased` (what the
  run's release policy put on the floor during the advance) and
  `backlogCount` (orders the policy could still release — a caller jumping
  until the run drains stops on `wipCount === 0 && backlogCount === 0`), the
  same kind of agent-visible signal. `unlock` is **not** a reset — it clears a
  lock a dead process left, and re-creating a run with the same seed reproduces
  it exactly, so rewinding one is not a feature. `work_orders.status` still has
  no writer and should not gain one here: a release is per-run
  (`run_released_orders`), so a single global column cannot say whether a work
  order is running.
- Deletes come in two flavours. Sales and work orders cascade their allocations, so `DELETE` refuses with `409 { message, requiresConfirmation: true, allocations }` and the client re-sends with `?force=true`. Work centers do **not**: `routing_steps.work_center_id` is `ON DELETE RESTRICT`, so a referenced centre can't be removed at all and its 409 deliberately omits `requiresConfirmation` — `deleteConflict()` on the client ignores it and the message lands in the error toast instead of a confirm dialog. Don't add a `?force=` path there without changing the FK.
- Parts carry **both** shapes, because their three foreign keys disagree: `work_orders.part_id` and `sales_orders.part_id` are RESTRICT (hard refusal, no `requiresConfirmation`) while `routings.part_id` is CASCADE (confirmable, `?force=true`). `DELETE /api/parts/:id` checks RESTRICT first — when an order references the part no amount of force helps, so offering a confirm dialog would be a lie. `DeleteConflict` in `api/client.ts` therefore carries `allocations?` and `routings?` as optional per-resource detail.
- Tests run under vitest with `environment: node` (`backend/vitest.config.ts`), the same way the frontend runs the simulation engine — pure functions only, no DB and no HTTP in the suite. `tsconfig.json` sets `"types": []`, so test globals are imported explicitly from `vitest` rather than relied on ambiently. The config's `include` is scoped to `src/**/*.test.ts` because `npm run build` compiles tests into `dist/` too, and an unscoped vitest would collect that stale copy as a second suite.
- Request bodies, path params, and query params are validated with zod schemas in `src/schemas/orders.ts`, applied via `parseOr400` (`src/lib/validate.ts`), which writes a `400 { message }` and returns null so the route early-returns. Every error response in the API is `{ message }`, and the frontend toasts that text verbatim.
- Writes that span tables run in `db.transaction()`; helpers inside a transaction throw `HttpError` (`src/lib/httpError.ts`) to both roll back and carry a status. This is why `db/index.ts` uses the Neon WebSocket `Pool` rather than the HTTP driver, which has no transaction support.
- Allocation rules live in `src/lib/allocate.ts` as pure functions taking plain objects, so they are unit-testable without a database. Allocations for a work order **must** be inserted in one statement, oldest-sales-order-first: ids come out ascending in insert order, and `calculateThroughput` credits finished units in allocation-id order.
- Joins/aggregation are done in JS after separate `db.select()` calls rather than in SQL (see `salesOrders.ts` grouping allocations by sales order, `routings.ts` attaching ordered `steps`).
- The nine `run_*` / `simulation_runs` tables are one run's history;
  everything above them in `schema.ts` is the shared factory definition.
  **The invariant: once a run exists, the engine reads that run's own config —
  `run_work_centers` for machines, operators, standing cost, wages and the
  capital prices, `run_work_order_steps` for
  steps, `simulation_runs` for the facility rates and `day_ticks` — and never
  `work_centers`, `routing_steps` or `factory_settings` again.** That is what lets two runs
  disagree about the drill press, and what makes forking a copy rather than a
  versioning scheme. That frozen config has exactly two **writers**: a capital
  action (6E), which charges the run's frozen price, re-dates the rate it
  moved and appends a `run_capital_actions` row, and a policy change
  (`POST /api/runs/:id/policy`), which updates the run's five release-policy
  columns on `simulation_runs` (`release_policy`, `wip_cap`,
  `release_lead_days`, `drum_work_center_id` — un-keyed, a frozen copy —
  `drum_buffer`) under the same lock, unlogged because it moves no money. It
  is still never re-read from
  the live tables — buying a machine or re-policying one run leaves every
  other run, and the
  factory, alone. Steps are pinned per **work order** at release, so editing
  a routing changes only releases made after the edit and never re-plans a part
  already halfway through a route. Track 7 makes the copy literal: `forkRun`
  copies every `run_*` table row-for-row under the parent's lock, in one
  transaction. **A new `run_*` table must join `forkRun`'s copy list** —
  nothing catches a missed table automatically, while a missed *column* is a
  compile error via its `CopyOf` annotations. The WIP copy goes through JS in
  id order because admission order is list order; everything else is
  server-side `INSERT … SELECT`.
- History cascades from `simulation_runs`, and references out to the shared
  definition are RESTRICT — a work order a run has released can't be deleted
  from under it. Five columns are deliberately **un-keyed**: `work_center_id`
  in `run_work_centers`, `run_work_order_steps`, `run_bucket_work_centers` and
  `run_scrapped_parts`, plus `run_released_orders.routing_id`. A pinned copy
  and a set of
  observations exist to outlive edits to what they copied; an FK would either
  erase a finished run's history when a centre is retired or add a 500 path to
  work-centre deletion. `run_finished_parts` freezes its money columns at
  finish time for the same reason — otherwise deleting a sales order rewrites
  what a finished run earned — and `run_scrapped_parts` freezes the ruined
  unit's `material_cost_cents` the same way. `npm run seed` deletes
  `simulation_runs` first.
- `/floor` and `/metrics` deliberately answer different questions. `/floor` is
  a **snapshot** — what is at each center and how far along — built by the pure
  `deriveFloorView`, and it is what the simulation page's cards draw.
  `/metrics` is a **rate over a window**, and must come from the tick's own
  emitted observations. A machine can read `slotsInUse: 0` on the floor having
  been busy for the whole of that tick, because the part it held finished the
  step and moved on; that is exactly the undercount that makes a post-tick
  snapshot the wrong source for utilization. `WorkCenterFloorView` therefore
  has no `utilization` field at all — an instantaneous `slotsInUse / capacity`
  reads only 0, ½ or 1, and naming it utilization invites the confusion.

### Simulation engine (`backend/src/simulation/`)

The backend owns the engine: `types.ts` (narrow structural input types that
Drizzle rows satisfy without mapping), `sampleProcessTime.ts`,
`simulationTick.ts`, `calculateThroughput.ts` and `operatingExpense.ts`. Pure
functions, no DB and no HTTP, unit-tested under `environment: node`.

**The cost model (Tracks 6A/6D).** Ticks are **staffed seconds**; a calendar
day is `shifts × 28,800` ticks (8-hour shifts) — `TICKS_PER_DAY` ×
`factory_settings.shifts` (1–3, overridable in `POST /api/runs`), frozen per
run as `simulation_runs.day_ticks`. Per-day rates are entered per true 24h
calendar day and amortized over the
day's staffed ticks; overnight is not simulated and not skipped-with-gaps, it
simply isn't ticks. Five costs, and the rules per kind:

- **Time-based expense** (facility overhead + per-centre standing cost) is a
  pure function of the tick number — `floor((t−t₀)·r/D) − floor((t−1−t₀)·r/D)`
  — so batch splitting needs no cursor and a full day sums to exactly the rate.
  It is accrued **per rate and then summed**, never on the summed rate: floor
  diffs on a combined rate disagree with the summed breakdown mid-day, and the
  stored tick total must equal any per-centre breakdown by construction (the
  same principle as `calculateThroughput` being the sum of
  `creditFinishedParts`).
  `t₀` is the tick the rate took effect (`DatedRate.sinceTick`), which 6E's
  capital actions move: a rate charges from `t₀ + 1` onward, each segment
  accruing exactly the floor of its own duration, and `t₀ = 0` — every rate no
  action has touched — is the original arithmetic byte for byte. The epoch is
  **per rate**, so buying a machine at the drill press re-phases that centre's
  rent and nothing else's. Because an action takes the run's lock, a batch
  never spans a change.
- **Carrying cost** (basis points of on-floor material value per day) is the
  one true accumulator, since it depends on what sat on the floor: a fold over
  `cents · bps` numerator units with a remainder in `[0, 10000·day_ticks)`,
  persisted as `simulation_runs.carry_remainder` and carried through
  `RunState`/`RunBatch` like `priorCounts`. Exact, not drifting — the lifetime
  total is the floor of the ideal charge however the run was chunked. It
  charges the **end-of-tick** floor (the set `wipCount` counts), so a part
  finishing during a tick pays no rent for it.
- **Wages (6D)** are the same floor-diff accrual but over `TICKS_PER_HOUR`
  (3,600) rather than the day: an operator is paid per **staffed hour**, so a
  second shift doubles a day's wage bill while amortizing the same rent —
  which is the entire economics of adding one. The rate is
  `work_centers.wage_cents_per_hour` per operator, frozen into
  `run_work_centers` alongside `operators` (6E's explicit column; the migration
  backfilled it to the machine count, which is what it meant before), and
  `loadRunState` pre-multiplies so the engine (`wagesAtTick`) sums per-centre
  rates without knowing about operators. Its own frozen tick column
  (`run_buckets.wage_cents`) and its own P&L line —
  `netCents = throughput − OE − carrying − wages − capital` — because the
  wages-vs-rent
  split is what a shift decision is about. There is deliberately no overtime
  yet: overtime's whole economic identity is its **premium**, and priced at the
  normal wage it costs what a temp's hour costs while needing no hiring, so it
  would dominate both the shifts setting and 6E's hire/fire. It waits for 6F
  along with mid-run shift changes, which need a non-uniform calendar day.
- **Capital spend (6E)** is the one cost that is *not* an accrual: buying a
  machine or hiring an operator charges a lump at the tick the action lands,
  frozen on an append-only `run_capital_actions` row (salvage from a
  retirement is a **negative** spend, so the line is one sum over one column).
  Amortizing it was rejected on timescale: a realistic five-year machine life
  is ~$11/day against a ~$1,900/day factory, so a purchase would be free
  inside the days a run spans and "always buy" would be right every time —
  the degenerate objective 6A exists to prevent. A lump also makes payback
  readable straight off the net curve, and keeps amortization layerable later
  off the frozen column, the 6B/6C pattern. There is **no cash balance**: a
  run cannot be refused a purchase for want of funds, and net simply goes
  further negative.
- **The accrued cents are frozen** into `run_buckets.operating_expense_cents` /
  `carrying_cost_cents` / `wage_cents` — per simulated minute since 6G, summed
  from the ticks in it — and every P&L read sums those rows, never
  re-derives from
  rates — so a later rate edit (or a 6E capital action) cannot rewrite what a
  finished run spent. Per-centre expense over a window is deliberately *not*
  served: `rate × window` is only valid while rates are constant per run, and
  6E broke that — which is also why `rateWindowCents`, the telescoped
  O(1) window 6A.2 built for a read that was never served, is **deleted**
  rather than dated. A window can span a rate change, so the telescope no
  longer holds, and summing the frozen tick column is the only honest answer.

Two rules the port established, and both matter to how failures surface:

- Randomness is **not** drawn at call time. `sampleProcessTime` is a pure
  function of `(seed, workOrderId, unitIndex, stepIndex)`, so a run persists a
  single `rng_seed` and nothing else — a replay, a re-creation or a fork
  reproduces every draw with no cursor to restore. Don't reintroduce
  `Math.random()`, and **don't put the part's uuid or the run id in the draw
  key**: uuids are minted fresh at every release, so keying on one (as the
  engine did until 2026-09-03) means two runs created with the same seed draw
  different noise and comparing them measures the dice rather than the
  decision. `UNIQUE(run_id, work_order_id, unit_index)` is what makes the key
  name exactly one part. Two parts of one work order differ only by
  `unitIndex`, so a test giving both index 0 will see them move in lockstep —
  a release numbers them 0..quantity-1.
- A referenced-but-absent record **throws** (a work order's pinned steps, a step's work
  center, a finished part's work order, an allocation's sales order). A silent
  zero reads to a fork comparison as a policy that lost money rather than as a
  bug. An *uncovered* unit is different — it legitimately earns nothing.

`calculateThroughput` is the **sum** of `creditFinishedParts`, which credits
each finished unit to the allocation covering it and returns
`FinishedPartCredit` per part — the shape `run_finished_parts` freezes. The
total and the per-part attribution must agree by construction: a run stores the
parts and charts the total, and two code paths would eventually disagree about
what a run earned. `salesOrderId` and `unitPriceCents` are null together and
only for an uncovered unit, whose material cost is still recorded. `dueAtTick`
(6B) is frozen the same way but does **not** share that invariant: it is null
for an uncovered unit *or* a covered unit whose order made no promise, and the
row's `sales_order_id` is ON DELETE SET NULL while the due tick stays frozen —
so on-time delivery reads only `dueAtTick`, never infers from `salesOrderId`.
Due dates live on sales orders in **calendar days** and become ticks in exactly
one place, `loadRunState` (`dueDay × the run's frozen day_ticks`); the engine's
`SalesOrder` carries `dueAtTick` required-nullable, and on time means
`completedAtTick <= dueAtTick` — the due tick itself is on time. There is
deliberately **no money penalty**: lateness feeds the OTD metric only, and
`netCents` is unchanged.

**Setup and scrap (6C)** are both per pinned step
(`run_work_order_steps.setup_time_seconds` / `scrap_bps`, copied from
`routing_steps` at release like everything else a run reads). Setup is
**machine time, not a money charge**: one changeover per (work order, step),
paid by whichever unit is *admitted to a machine first* — folded into that
unit's `actualProcessTimeSeconds` — so its cost surfaces as rent against time
and lost constraint minutes, and `busy` counts a machine in setup as busy.
Admission-pays, not arrival-pays: units can arrive out of admission order, and
the payer is deterministic because list order is. It is deterministic — no
draw — and the paid state persists as
`run_work_order_steps.setup_started_at_tick` (null = not yet), because it must
survive a batch boundary and deriving it fails once the paying unit scraps out
of the very step it set up; a part already mid-process never pays, so pre-6C
runs are never retro-charged, and a zero setup time is never recorded. Scrap
is a probability in basis points drawn **at step completion** — the machine
time is spent, then the unit fails — through the seeded RNG in a separate
**draw domain** (`unitDraw`'s second argument; the process domain is the
unmarked legacy key, byte for byte, so pre-6C runs still re-create exactly).
A scrapped unit leaves the floor that tick as a `run_scrapped_parts` row with
its `material_cost_cents` frozen, and **never reaches `creditFinishedParts`**:
it consumes no allocation, the next good unit takes its sale, and a short work
order under-delivers — which, with the wasted machine time and carrying
already paid, is scrap's whole money bite. **No write-off**: like an uncovered
unit's material, a scrapped unit's is recorded, not charged, and `netCents` is
untouched — a penalty stays layerable off the frozen column, the 6B pattern.

Advancing a run is split across the pure/impure line. `simulateBatch`
(`simulation/simulateBatch.ts`) takes a `RunState`, ticks it N times in memory
and returns a `RunBatch` — the surviving WIP, the finished and scrapped
records with their
frozen money, a `TickRecord` per tick, the advanced `priorCounts` and
`setupDone` set, and the batch's newly-started setups — while
`lib/runService.ts` only loads the state (via `lib/runState.ts`), calls it,
and writes the batch. All
the logic that decides anything is therefore under test with no database;
`runService` holds no arithmetic. `priorCounts` advances *within* a batch, so a
unit finishing at tick 5 is priced against the allocation after the one that
covered a unit finishing at tick 3, and carrying it out means a long advance
runs as several batches without re-reading it — `setupDone` and the carrying
remainder travel the same way.

`runService` writes per batch, never per tick — `TICKS_PER_BATCH` is 3600
(one staffed hour), each
batch one transaction, so a crash costs at most one batch. **The release
policy (RP) is evaluated between batches**, at the advance's start and then
hourly: `planReleases` (pure, `simulation/releasePolicy.ts`) plans from the
tick, the floor and the backlog; `buildReleaseParts` +
`admitOrderIntoState` (`simulation/releaseAdmission.ts`, shared with the
manual release so the draw key cannot drift) graft the release onto the
in-memory state, whose parts then ride the batch's WIP replace; and the
`run_released_orders` / `run_work_order_steps` rows are written **first
inside that batch's transaction**, so a crash loses the batch and its
releases together, never a released order with no parts. The backlog
(`loadReleaseBacklog`, `runState.ts`) is read live once per advance request
— a work order created mid-advance is invisible until the next request, the
same class of caveat as the live demand read. Under `manual` no backlog is
read and behaviour is byte-identical to before RP. Inserts are split
per table by `chunkFor(paramsPerRow)`, because Postgres caps bind parameters
near 65535. Since 6G stores observations per simulated minute a day is ~5.3k
observation rows rather than ~320k, so the chunking now matters most to the WIP
replace. Both
advancing and releasing take the run's `advancing` lock via `withRunLock`: an
advance replaces the WIP rows wholesale, so a release landing mid-batch would
be deleted by the write that follows it.

`simulateTick` returns `metrics: TickMetrics` alongside the parts: `tickNum`,
`wipCount`, and a `{ workCenterId, busy, queued, capacity }` entry **per work
center in
the map, idle ones included**. `busy` counts machines, not parts. This is
emitted rather than derived afterwards because a part that finished during the
tick held a machine for all of it and is gone from `wipParts` by the time
anything could look — so a centre's busiest ticks are exactly what a post-tick
snapshot undercounts. `capacity` is emitted for the same reason since 6E: it is
the **effective** capacity the tick admitted against (`min(machines,
operators)`, taken at the load boundary so the engine never learns what an
operator is), and a capital action moves it mid-run, so the observation has to
carry its own denominator. Keep the list total.

`aggregateMetrics` in `metrics.ts` reduces a window to utilization (busy
machine-ticks ÷ **summed capacity-ticks**, reported as `capacityTicks`), queue
depth and WIP — but it takes **observation buckets, not ticks**, since 6G.
`observationBuckets.ts` owns that layer: `bucketTicks(series, width)` groups a
tick-ordered series onto an absolute grid, and a single tick is simply a bucket
of one, so one aggregate serves a stored series, a live batch and a test's
hand-built ticks. `TICKS_PER_BUCKET` (60, one simulated minute) is a
**constant**, not frozen per run like `day_ticks`: Track 7 can only compare two
runs' observations if both are bucketed the same way, and resolution — unlike
shifts — changes nothing about what a run's money means.

Every field on a bucket is a **sum, a count or a max**, never a mean, which is
what makes the grouping lossless: divide once, at the end. Money needs one
field each; **WIP needs three**, because it is a level rather than a flow —
`wipPartTicks` is the mean's numerator, `maxWip` a peak no sum recovers, and
`endWip` the closing level. Don't collapse them: a mean of closing levels is
not a mean. Per-centre `observedTicks` is what makes the utilization
denominator right rather than being it — a work center created mid-run isn't
reported idle for time it did not exist — and a centre retired to no machines
contributes no capacity-ticks, so it reads 0 instead of dividing by zero.
Stored observations from before 6E have a null `capacity` column and fall back
to the run's frozen capacity, which is exactly what it was throughout a run
that could not change it.

A window's default bounds are the **whole run, from tick 0** — not tick 1,
though ticks are numbered from 1. Tick 0 is a real moment at which money is
spent: a capital action applied before the first advance. Defaulting to 1 hid
that spend from every whole-run `/metrics`, so the dashboard read a run better
than the run bar did (6E.7).

Cycle time comes from the other series: `WipPart` carries `releasedAtTick` for
its whole life and `finish()` copies it onto the `FinishedPart`, so
`aggregateCycleTime` needs nothing but the finished records.
`completedAtTick - releasedAtTick` counts queueing, not just processing.
Windowing is the **caller's** job for both aggregates — filter by tick and hand
over what falls inside — so one function serves a live batch and a stored range.
They window independently, on `TickMetrics.tickNum` and on
`FinishedPart.completedAtTick` respectively. Empty inputs don't throw: a run
that never advanced has no ticks, and `aggregateCycleTime` returns nulls rather
than zeroes because zero is itself a reachable cycle time.
`aggregateOnTimeDelivery` windows on `completedAtTick` alongside cycle time and
follows the same null rule twice: `onTimeFraction` is null when no finished
unit carried a promise ("no promises" is not "100% kept"), and the lateness
stats cover late units only, null when every measured unit was on time. It
never throws — due-before-release is legal, an order can already be late at
release. `groupDeliveryBySalesOrder` reuses it per covering order, so the
per-order rows and the overall aggregate agree by construction.
`aggregateScrap` windows on its own column, `scrappedAtTick`, and answers an
empty window with **zeroes, not nulls** — zero scrap over observed ticks is a
real observation, the factory ran clean.

## Frontend architecture

Routing: `main.tsx` defines the router; `App.tsx` is the layout shell (`NavBar` + `<Outlet/>`, wrapped in `ToastProvider`), with `SimulationPage` at `/`, the order entry module under `/orders` — `OrdersLayout` with `SalesOrdersPage` at `/orders/sales` and `WorkOrdersPage` at `/orders/work` — and the factory setup module under `/setup` — `SetupLayout` with `WorkCentersPage` at `/setup/work-centers`, `PartsPage` at `/setup/parts`, `RoutingsPage` at `/setup/routings` and `FactorySettingsPage` at `/setup/settings` (the facility-level cost rates, the shifts-per-day setting and the release-policy defaults as a singleton form with an explicit Save — the tables-are-their-own-edit-surface convention is about rows). `/create` was a stub page and now redirects to `/orders/sales`.

Both modules follow the same shape: a `*Layout` renders a `*DataProvider` that loads every list the module needs in one `Promise.all` and exposes per-resource refetches, so sibling pages share one fetch and navigating between them doesn't refetch. `SetupDataProvider` loads parts, routings and the factory settings alongside work centers, because the routing editor will need the first three and the settings page edits the last.

`src/api/client.ts` holds the API base URL (still hard-coded `http://localhost:3000` — no env var yet) plus `getJson`/`postJson`/`patchJson`/`putJson`/`deleteJson` and `ApiError`, which carries the status and parsed body so callers can branch on a 409 instead of only toasting. `SimulationPage` predates it and still calls `fetch` directly.

`src/data/*.ts` are stale unused fixtures that no longer match the current types. Don't use them as a reference.

### Driving a run (`src/pages/SimulationPage.tsx`)

**The frontend has no engine.** It was deleted when the page switched over;
`src/simulation/` holds only pure, unit-tested chart/display transforms —
`cumulativeThroughput.ts` (+ `openingCents`), `netProfit.ts`,
`throughputRate.ts` (`trailingRate`), `capital.ts` (action labels and
`formatSpend`) and `simTime.ts`
(day/time/duration formatting, `chartBucket`). `standingCost.ts`
(`windowStandingCostCents`) is **deleted**: it derived a per-centre cost as
rate × observed ticks ÷ `dayTicks`, and 6E made the rate per *machine* with
the machine count itself movable mid-window, so the figure was wrong twice
over. `capacityTicks` is not a substitute — rent is owed on machines whether
or not anyone staffs them, and capacity-ticks count staffed ones. Don't reintroduce simulation
logic here — the backend owns it, and two copies drifted badly the one time
they coexisted.

The page drives a server-side run: it picks or creates one, releases work
orders into it, and a `setInterval(…, 1000)` calls
`POST /api/runs/:id/advance {ticks: 60}` — one tick is one simulated second,
and the live clock plays **one simulated minute per real second**
(`CLOCK_TICKS_PER_BEAT`), which restored the visible pace after the 6A seed
moved process times to minute scale. It holds no simulation state — WIP, money
and the tick number are the run's, so a reload resumes the same run and two
tabs cannot disagree. The run bar shows the tick as calendar time
(`formatTickTime`, "Day 2 · 3:41:05" — staffed time, the only time a run
simulates).
Advancing holds a server-side lock, so an overlapping call is a 409; an
`advancing` ref skips a beat rather than queueing one, the interval being a
display clock. Stopping is client-side only: the run keeps its state and
resumes where it left off.

**Fast-forward is the point of the page, not a faster clock.** There is
deliberately no arbitrary speed multiplier: the question a run answers is
where a set of releases ends up, and a "100×" button lies the moment the
multiplier outruns the server's ~500–4000 ticks a second (the minute clock's
60-a-beat is far inside that; an unbounded multiplier isn't). The jumps sit
beside the clock as calendar units — `JUMP_PRESETS`: **+1 hour / +4 hours /
+1 day**. **Run until idle is gone**, removed with Track 6A: an empty floor
stopped being a goal the moment rent accrues against time — an idle factory
is a money furnace, and "run out the order book" is not a question a factory
asks.

A jump chunks at `CHUNK_TICKS` (3600 — one staffed hour), matching the
server's `TICKS_PER_BATCH`, so a chunk is exactly one transaction and **Stop
always lands on a committed tick boundary** — it stops dispatching and never
aborts in flight, because the server commits that batch regardless and an
aborted request would only leave the page claiming a tick the run has passed.
**A jump streams rather than blocks**: there is no modal overlay
(`SimulatingOverlay` is deleted) — progress is inline in the transport bar
with Stop beside it, and the page refreshes as each committed hour lands, so
a day reads as the charts flying through it. A jump also **stops itself when
the floor empties** (the toast names the Day · time): nothing can land
mid-jump *by hand* — the jump holds the run's lock — but the run's own
release policy (RP) can: an advance feeds the floor from the backlog, so a
jump drains only when `wipCount === 0 && backlogCount === 0`, both off the
advance's own answer, and a jump on an empty floor is refused only under
`manual` (or with nothing left to release). A policy's releases during a
jump land in one end-of-jump toast. A jump **stops the clock
first** and waits out any beat in flight, and releasing does the same wait:
all three contend for the same lock, and letting them collide would raise the
very 409 the unlock action is there to cure. The work-order picker lists
only orders not yet released into the selected run — (run_id, work_order_id) is
the release table's primary key, so a second release is a 409 better made
unselectable than toasted.

That action is the other half: a tab closed or a server restarted mid-jump
leaves `status = 'advancing'` with no process behind it, and every advance is a
409 thereafter. `reportAdvance` gives that 409 a **"Clear stale lock"** button
on the toast (`ToastAction`, which is why `showToast` takes a third argument
and an action toast lives 12 s rather than 3.5 s). It is worded as an assertion
the user is making, not a retry: if the run really is advancing elsewhere,
clearing the lock lets two writers rewrite the same WIP rows.

`RunDashboard` (the Dashboard tab, Track 5, P&L'd in 6A) is what a jump lands
on — stat cards led by the window's **net profit** (signed, destructive below
zero), then throughput, operating expense and carrying cost, ahead of finished
count, cycle time, on-time delivery (— when no promised unit finished in the
window; destructive styling stays reserved for money), wages, scrap (count,
with the
frozen material cents in the detail — neutral styling, since that money is
recorded, not charged) and WIP, over a
Deliveries table (per-order shipped/on-time/late — which promise broke; order
numbers and quantities join client-side from the live sales orders, and Due
reads `dueAtTick / dayTicks` back as a day) and a work-centre table ranked by
**utilization descending**, the constraint on top; ranking is safe
there because the pane redraws only when a window is asked for, unlike the
floor, whose row order stays stable by name. The utilization bar shifts to the
`saturated` token at 90%. It shows the whole run when a run is opened,
re-windows onto the jump's own ticks (`startTick + 1 … startTick + done`)
right after a jump, and adds window controls (whole run, last-N presets, a
custom from–to) — the only ways `/metrics` is fetched, and **never** on the
clock's beat: it reads and aggregates every tick row, per-centre row and
finished part in the window. The window label comes from the *response*, so a
dashboard left over from an earlier window states what it covers rather than
misleading — the ledger's own case is a centre reading 10% utilization over a
run and 52% over the ticks it worked. Work-centre *names, machines, operators and the frozen
rates and prices* come off `/floor`, since `/metrics`
carries ids and a run keeps no copy of the names — the Deliveries table's
client-side join to `GET /api/sales-orders` is the same pattern. Its Machines
and Operators columns are therefore **current config, not window figures**,
and the operator count reads in the `starved` tone when it differs from the
machine count: one of the two is being paid for and not used. Beside them sit
`busyMachineTicks` and `capacityTicks`, the utilization fraction's own two
halves. Below the deliveries, the **capital log** (`GET /:id/actions`) lists
every action whole-run with what it cost and the config it produced —
whole-run on purpose, since an action is a decision taken at a tick, not a
rate over a window, and reading it against the window containing it is the
point. The window line shows ≈ days via the run's frozen `dayTicks`
(`simTime.ts`, 28,800 fallback).

**The release policy lives in a dialog off the transport bar too**
(`PolicyDialog`, the button naming the active policy — `Policy · CONWIP`):
picking one is a run-level decision, the dialog seeds from the run's own
frozen columns (null-draft pattern, no effect), and `onPolicyChange` follows
the capital-action lock protocol exactly. The Factory Settings page carries
the same five fields as the defaults a new run freezes;
`simulation/releasePolicy.ts` holds the labels, hints and `policySummary`
(the `capital.ts` pattern).

Capital actions live in a **dialog** off the transport bar, not in more bar
controls: buying is a whole-factory question, so what answers it is the table
showing every centre's machines, operators, rent, wages and prices at once,
with the short side of `min(machines, operators)` called out. Applying one
waits the clock's beat out and holds the `advancing` ref exactly as releasing
does — all three contend for the same server lock — and the buttons are
disabled during a jump, which holds it outright. Prices shown are the run's
**frozen** ones off `/floor`, so a price edited in setup after the run started
neither changes the quote nor what the server charges.

The page is two persistent control bars (run picking/creation, then
transport: clock, release, capital, fast-forward) over three tabs — **Floor**,
**Trends**, **Dashboard** — named by view shape (a snapshot of now, series
over time, an aggregate over a window), because "Throughput" stopped being an
honest tab name once rate and WIP moved in and "Metrics" overlapped it —
throughput is itself a metric. Every control stays on screen. The floor is
`WorkCenterTable`, one row per centre from `GET /:id/floor` in stable name
order — the floor redraws every tick, so the queue signal is the badge and the
Waiting column, never the row order; the Trends tab reads `GET /:id/ticks` once
and derives its four series from it (see the chart pipeline below). The table shows the run's **frozen effective** capacity
read-only — editing the live work center would change nothing about a run
already created, and capital actions are the way a run's own capacity moves —
with an unstaffed machine (or an operator with no machine) called out beside
the slot count rather than hidden behind a smaller number. There is no
"% utilized", which was `slotsInUse / capacity` and
could only read 0% or 100% for a single machine.

### Throughput (money) model

Throughput is measured in **cents**, not parts, and since Track 6A it is only
half the score: a run's `netCents` is throughput minus operating expense,
carrying cost, wages and capital spend, computed at read time from frozen
columns on every side. `calculateThroughput` credits `salesOrder.unitPriceCents - part.materialCostCents` for a finished unit only if that unit is covered by an `allocation` linking its work order to a sales order; units beyond the allocated quantity earn nothing. Allocations for a work order are consumed in `id` order, and a unit's position is `priorFinishedCount + alreadyFinishedThisTick`, so **finish order determines which sales order (and price) a unit is credited to**.

The Trends tab is **one chart on one clock** (`TrendsChart`; the per-series
`TickSeriesChart` wrapper is deleted) drawing four series from one
`GET /:id/ticks` response, each hideable by clicking its legend entry — the
relationships are the point, and three separate cards made the viewer
assemble them by eye. Money shares the left axis, WIP (a step line off
`wipCount`) sits on the right, the x-axis and tooltip speak Day · time
(`formatTickShort` / `formatTickTime`), never raw ticks. The series: the
stored per-bucket money **accumulated**
(`openingCents(history, run.throughputCents)` →
`cumulativeThroughput(history, opening)`), **cumulative net profit**
(`netPerTick` → the same accumulator, seeded by
`openingNetCents(history, run.netCents)` — net crossing the dashed zero is
the run turning profitable), and the **trailing-hour earning rate** in cents
per staffed hour (`trailingRate`, 3600-tick window over samples
`seriesBucket` apart — finishes are point events minutes apart, so a shorter
window reads as a comb, which is noise, not rate). For the cumulative curve the **opening balance
is not optional**. `/ticks` keeps only the newest 5000 rows of whatever
resolution is asked for, so an over-long series is a *suffix* of the run and a
curve accumulated from zero re-bases and contradicts the money in the line
above it. The Trends tab mostly avoids the cap by asking for the series
**bucketed** (`chartBucket`: simulated minutes while the run fits on screen,
then hours — a day is 480 minute-points), which keeps the
whole run visible and recharts fast; bucket sums keep the opening-balance
identity exact. `chartBucket` never asks finer than the stored minute, and that
is load-bearing rather than tidy: its value is also `trailingRate`'s sample
spacing, so asking for seconds while the server returns minute rows would
divide the rate by 60× too few ticks. The rate over a bucketed series is `trailingRate(history, bucketTicks)` —
the sliding window counts samples but divides by ticks, so raw and bucketed
series of the same flow agree. It is exact rather than approximate
because a tick's `throughputCents` is the sum of its parts' credits and the
run's total is the sum of the same frozen per-part columns, so what the run
earned before the window is the total minus the window's own sum, and no API
change is needed. It floors at zero: the summary and the series are two
requests, and an advance landing between them leaves the window holding money
the total has not counted yet. `openingNetCents` is the same identity for the
net curve with the floor deliberately **absent** — net before the window can
legitimately be negative, and clamping would redraw a loss as break-even.

The rate and WIP series are local by construction, so the suffix needs no
opening correction for them — but the series start does create a *left edge*:
`trailingRate` divides points earlier than a full window into the series by
the ticks actually covered, never by the full window, because the data before
the first sample isn't zero, it's absent, and a full-window divisor would draw
a fake ramp at the start of every chart.

**Compare (Track 7)** overlays a second run's net curve — dashed, same money
axis, `Net — #id name` in the legend — picked from a small Select in the
Trends card header (any other run, not lineage-only: two same-seed siblings
are the same comparison a fork is). Both series are fetched at **one shared
bucket**, `chartBucket(max of the two tickNums)`, because the absolute grid is
what lands both curves on the same ticks *and* the bucket is `trailingRate`'s
sample spacing — fetching the two runs at different widths would misalign the
merge and skew the rate. The compare run's summary is re-read alongside its
series since its `netCents` seeds `openingNetCents` for the compare curve; the
merge itself is the pure `mergeCompareNet` (`simulation/compareTrend.ts`),
which unions the two tick sets and leaves one-sided ticks (a run that advanced
further, a trailing partial bucket off the grid) carrying one side only — the
chart bridges those with `connectNulls`, since absent isn't zero. When the
compared pair is parent/child in either direction, a vertical "fork" reference
line marks where the shared history ends — the seam the payback question
starts from. Compare state lives in `useSimulationPage` (`compareRunId`,
`compareRun`, `compareSeries`, `selectCompare`) because `loadSeries` owns the
shared-bucket rule; `selectRun` resets it. Both branches still read **live
demand** (orders, prices, allocations) via `loadRunState`, so editing demand
between branch advances diverges them for a reason the seed doesn't explain —
same as two same-seed runs, not an RNG bug. The dashboard deliberately stays
one run's window; comparison is the Trends chart's job.

### React state notes

The page holds two refs, both about who owns the run's lock: `advancing` is
true while any advance is in flight, so the display clock's beat skips rather
than queues and a jump waits a beat out instead of racing it into a 409, and
`stopJump` is what Stop sets — read at the top of the chunk loop, so stopping
lands on a committed boundary.

(The refs that used to mirror `routings`, `workOrders`, `parts` and
`salesOrders` for the tick callback, and the lazy `GET /api/routings/:id` that
instantiated WIP parts with `crypto.randomUUID()`, went with the frontend
engine in 3.4. Releasing is `POST /:id/releases` now and the server pins the
steps.)

### Shared UI primitives

`src/components/ui/` (lowercase files) is shadcn/ui — generated components,
owned by the repo and editable (`table.tsx` already dropped its nested x-scroll
wrapper so sticky headers work; `components.json` configures
`npx shadcn add <component>` for new ones). Tables stay deliberately not
data-driven — every table has conditional cell colouring, computed values and a
bespoke last column, so the JSX structure lives at the call site built from
`Table`/`TableHeader`/`TableRow`/`TableCell`.

The uppercase files are ours: `Field.tsx` (a Label wrapping its control — no
htmlFor/id pairing anywhere, nesting does the association), `DeleteButton` and
`InlineInput` (reads as table text until hovered/focused — the setup tables are
their own edit surface). `ConfirmDialog` wraps the shadcn Dialog behind the old
prop shape. **The toast is deliberately not sonner**: `ToastProvider` carries
the `ToastAction` third argument and the 12s-vs-3.5s lifetime that the "Clear
stale lock" button depends on, and stays hand-rolled until migrating it is its
own task.

Ordered-list editing lives in `src/setup/routingSteps.ts` — `moveStep`,
`removeStep`, `parseSteps`, `toDrafts` — pure functions unit-tested like the
simulation engine, with `StepEditor` as the shared UI over them.

`src/setup/workCenterFields.ts` is the same idea for the work-centre editor's
seven numeric columns: a spec (`WORK_CENTER_FIELDS`) driving the create
dialog's fields, the draft seeding, the parse and the changed-column diff, all
pure and tested. It exists because the page previously declared, validated and
diffed each field by hand, and at seven the failure mode is silent — add a
column and forget it in the commit, and the input edits nothing. The **table
cells stay explicit** at the call site, which is what the
tables-aren't-data-driven convention is actually about: bespoke cells, not
bespoke plumbing. `count` fields are whole numbers, `money` fields are typed
in dollars and sent as cents through `dollarsToCents`.

## Styling

Tailwind v4 via the `@tailwindcss/vite` plugin — configured through
`src/index.css`, with no `tailwind.config.js`. The `@/` path alias maps to
`src/` (vite + both tsconfigs — `paths` without `baseUrl`, which TS6 deprecated).

**Style convention (established with the dark redesign):**

- **Tokens only, never palette literals.** All colour comes from the semantic
  tokens in `src/index.css` (`bg-background`, `text-muted-foreground`,
  `border`, `text-destructive`, …) — never `slate-*`/`blue-500` in a component.
  Retuning the look is an edit to `index.css` and nowhere else. Three
  factory-specific tokens carry machine state: `running` (green), `starved`
  (amber), `saturated` (red) — the only three states `/floor` can honestly
  distinguish, since a free machine always takes a waiting part.
- **Dark-only.** `class="dark"` is hard-set on `<html>` in `index.html`; the
  light block in `index.css` stays so flipping it back is one line, but no UI
  offers a toggle.
- **A page owns the viewport; regions scroll, pages don't.** The app shell is
  `h-dvh overflow-hidden`; every page is `flex h-full flex-col` with a
  `PageHeader` on top and a `min-h-0 flex-1 overflow-auto` region below
  (tables get `sticky top-0 bg-card` headers). Nothing actionable may sit
  below the fold.
- **Creation is a dialog.** List pages put their create form in a shadcn
  `Dialog` behind a "New …" button in the header, not in a card above the
  table.

## Working agreement

The global working agreement in `~/.claude/CLAUDE.md` applies. Project-specific
additions:

- **Where we are: read `PROGRESS.md` before starting work.** It is the
  operational ledger — one line per unit, with the current position at the top.
  Tick a unit's box in the same commit that completes it. The README holds the
  narrative roadmap; `PROGRESS.md` holds what to do next.
- Default unit order for a feature: schema/migration → engine + tests → API → UI.
  Each is its own commit.
- Write tests alongside the code, not after. Tests are the spec for what correct
  means.
- When a change invalidates something documented in this file, update it as part
  of the same commit.
