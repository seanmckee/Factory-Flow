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
  frozen throughput, operating expense, carrying cost, `netCents` — the score,
  and it can go negative), `GET /api/runs/:id/metrics?fromTick&toTick` (the
  same P&L windowed),
  `GET /api/runs/:id/floor`, `GET /api/runs/:id/ticks?fromTick&toTick`,
  `POST /api/runs/:id/releases`, `POST /api/runs/:id/advance`,
  `POST /api/runs/:id/unlock` and `DELETE /api/runs/:id`. `advance` caps
  `ticks` at `MAX_TICKS_PER_REQUEST` (20000) because advancing is synchronous
  at roughly 500 ticks a second; a caller that wants more calls again, since a
  run is resumable by construction. Its result carries the surviving
  `wipCount`, so a caller advancing until the floor is empty stops on the
  advance's own answer rather than chasing each call with a `GET /:id` that
  could already be a batch stale — it is `state.wipParts.length` after the
  last batch, not a query. `unlock` is **not** a reset — it clears a
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
- The eight `run_*` / `simulation_runs` tables are one run's history;
  everything above them in `schema.ts` is the shared factory definition.
  **The invariant: once a run exists, the engine reads that run's own config —
  `run_work_centers` for capacity and standing cost, `run_work_order_steps` for
  steps, `simulation_runs` for the facility rates and `day_ticks` — and never
  `work_centers`, `routing_steps` or `factory_settings` again.** That is what lets two runs
  disagree about the drill press, and what makes forking a copy rather than a
  versioning scheme. Steps are pinned per **work order** at release, so editing
  a routing changes only releases made after the edit and never re-plans a part
  already halfway through a route.
- History cascades from `simulation_runs`, and references out to the shared
  definition are RESTRICT — a work order a run has released can't be deleted
  from under it. Four columns are deliberately **un-keyed**: `work_center_id`
  in `run_work_centers`, `run_work_order_steps` and `run_tick_work_centers`,
  plus `run_released_orders.routing_id`. A pinned copy and a set of
  observations exist to outlive edits to what they copied; an FK would either
  erase a finished run's history when a centre is retired or add a 500 path to
  work-centre deletion. `run_finished_parts` freezes its money columns at
  finish time for the same reason — otherwise deleting a sales order rewrites
  what a finished run earned. `npm run seed` deletes `simulation_runs` first.
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

**The cost model (Track 6A).** Ticks are **staffed seconds**; a calendar day is
`shifts × 28,800` ticks (8-hour shifts) — `TICKS_PER_DAY` in
`operatingExpense.ts`, frozen per run as `simulation_runs.day_ticks`, one shift
today. Rates are entered per true 24h calendar day and amortized over the
day's staffed ticks; overnight is not simulated and not skipped-with-gaps, it
simply isn't ticks. Three costs, three rules:

- **Time-based expense** (facility overhead + per-centre standing cost) is a
  pure function of the tick number — `floor(t·r/D) − floor((t−1)·r/D)` — so
  batch splitting needs no cursor and a full day sums to exactly the rate.
  It is accrued **per rate and then summed**, never on the summed rate: floor
  diffs on a combined rate disagree with the summed breakdown mid-day, and the
  stored tick total must equal any per-centre breakdown by construction (the
  same principle as `calculateThroughput` being the sum of
  `creditFinishedParts`).
- **Carrying cost** (basis points of on-floor material value per day) is the
  one true accumulator, since it depends on what sat on the floor: a fold over
  `cents · bps` numerator units with a remainder in `[0, 10000·day_ticks)`,
  persisted as `simulation_runs.carry_remainder` and carried through
  `RunState`/`RunBatch` like `priorCounts`. Exact, not drifting — the lifetime
  total is the floor of the ideal charge however the run was chunked. It
  charges the **end-of-tick** floor (the set `wipCount` counts), so a part
  finishing during a tick pays no rent for it.
- **The per-tick cents are frozen** into `run_ticks.operating_expense_cents` /
  `carrying_cost_cents` and every P&L read sums them — never re-derives from
  rates — so a later rate edit (or a 6E capital action) cannot rewrite what a
  finished run spent. Per-centre expense over a window is deliberately *not*
  served: `rate × window` is only valid while rates are constant per run,
  which 6E breaks.

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
only for an uncovered unit, whose material cost is still recorded.

Advancing a run is split across the pure/impure line. `simulateBatch`
(`simulation/simulateBatch.ts`) takes a `RunState`, ticks it N times in memory
and returns a `RunBatch` — the surviving WIP, the finished records with their
frozen money, a `TickRecord` per tick, and the advanced `priorCounts` — while
`lib/runService.ts` only loads the state (via `lib/runState.ts`), calls it,
and writes the batch. All
the logic that decides anything is therefore under test with no database;
`runService` holds no arithmetic. `priorCounts` advances *within* a batch, so a
unit finishing at tick 5 is priced against the allocation after the one that
covered a unit finishing at tick 3, and carrying it out means a long advance
runs as several batches without re-reading it.

`runService` writes per batch, never per tick — `TICKS_PER_BATCH` is 500, each
batch one transaction, so a crash costs at most one batch and a 5000-tick
advance reads once and writes ten times. Inserts are split at
`ROWS_PER_INSERT`, because Postgres caps bind parameters near 65535 and 500
ticks of a twenty-centre factory is ten thousand per-centre rows. Both
advancing and releasing take the run's `advancing` lock via `withRunLock`: an
advance replaces the WIP rows wholesale, so a release landing mid-batch would
be deleted by the write that follows it.

`simulateTick` returns `metrics: TickMetrics` alongside the parts: `tickNum`,
`wipCount`, and a `{ workCenterId, busy, queued }` entry **per work center in
the map, idle ones included**. `busy` counts machines, not parts. This is
emitted rather than derived afterwards because a part that finished during the
tick held a machine for all of it and is gone from `wipParts` by the time
anything could look — so a centre's busiest ticks are exactly what a post-tick
snapshot undercounts. Keep the list total: `aggregateMetrics` in `metrics.ts`
reduces a window of these to utilization (busy machine-ticks ÷ capacity ×
observed ticks), queue depth and WIP, and per-centre `observedTicks` is the
denominator so a work center created mid-run isn't reported idle for time it
did not exist.

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

## Frontend architecture

Routing: `main.tsx` defines the router; `App.tsx` is the layout shell (`NavBar` + `<Outlet/>`, wrapped in `ToastProvider`), with `SimulationPage` at `/`, the order entry module under `/orders` — `OrdersLayout` with `SalesOrdersPage` at `/orders/sales` and `WorkOrdersPage` at `/orders/work` — and the factory setup module under `/setup` — `SetupLayout` with `WorkCentersPage` at `/setup/work-centers`, `PartsPage` at `/setup/parts`, `RoutingsPage` at `/setup/routings` and `FactorySettingsPage` at `/setup/settings` (the facility-level cost rates as a singleton form with an explicit Save — the tables-are-their-own-edit-surface convention is about rows — and the future home of calendar/shift settings). `/create` was a stub page and now redirects to `/orders/sales`.

Both modules follow the same shape: a `*Layout` renders a `*DataProvider` that loads every list the module needs in one `Promise.all` and exposes per-resource refetches, so sibling pages share one fetch and navigating between them doesn't refetch. `SetupDataProvider` loads parts, routings and the factory settings alongside work centers, because the routing editor will need the first three and the settings page edits the last.

`src/api/client.ts` holds the API base URL (still hard-coded `http://localhost:3000` — no env var yet) plus `getJson`/`postJson`/`patchJson`/`putJson`/`deleteJson` and `ApiError`, which carries the status and parsed body so callers can branch on a 409 instead of only toasting. `SimulationPage` predates it and still calls `fetch` directly.

`src/data/*.ts` are stale unused fixtures that no longer match the current types. Don't use them as a reference.

### Driving a run (`src/pages/SimulationPage.tsx`)

**The frontend has no engine.** It was deleted when the page switched over;
`src/simulation/` holds only chart transforms (`cumulativeThroughput.ts`,
`throughputRate.ts`), pure and unit-tested. Don't
reintroduce simulation logic here — the backend owns it, and two copies drifted
badly the one time they coexisted.

The page drives a server-side run: it picks or creates one, releases work
orders into it, and a `setInterval(…, 1000)` calls
`POST /api/runs/:id/advance {ticks: 1}`, so **one tick = one simulated second**
as before. It holds no simulation state — WIP, money and the tick number are
the run's, so a reload resumes the same run and two tabs cannot disagree.
Advancing holds a server-side lock, so an overlapping call is a 409; an
`advancing` ref skips a beat rather than queueing one, the interval being a
display clock. Stopping is client-side only: the run keeps its state and
resumes where it left off.

**Fast-forward is the point of the page, not a faster clock.** There is
deliberately no speed multiplier: the question a run answers is where a set of
releases ends up, not what it looks like going faster, and a "100×" button
lies the moment the multiplier outruns the server's ~500 ticks a second. So
the 1× clock is unchanged and the jumps sit beside it — `JUMP_TICKS`
(`100 / 500 / 1000`) and **Run until idle**, which advances until the floor is
empty or `IDLE_TICK_CEILING` (100000) stops it, so a floor that can never
empty doesn't advance until the tab closes.

A jump chunks at `CHUNK_TICKS` (500), matching the server's `TICKS_PER_BATCH`,
so a chunk is exactly one transaction and **Stop always lands on a committed
tick boundary** — it stops dispatching and never aborts in flight, because the
server commits that batch regardless and an aborted request would only leave
the page claiming a tick the run has passed. Until-idle terminates on
`AdvanceResult.wipCount`, not on a follow-up `GET`, so the loop makes no other
request; there is nothing per chunk to refresh, since the overlay shows
progress only. Floor, chart and strip refresh once when the jump lands.

`SimulatingOverlay` covers the page while it runs, and Stop is the only live
control in it — an until-idle jump can run to its ceiling and a reload would
strand the run's lock rather than end it. It appears on a 200 ms gate, which
every real jump clears; the gate exists so a jump that returns immediately
doesn't flash a modal. The bar is determinate only above one chunk, since a
one-chunk jump has nothing to report until it is already done. A jump **stops
the clock first** and waits out any beat in flight, and releasing does the same
wait: all three contend for the same lock, and letting them collide would raise
the very 409 the unlock action is there to cure. The work-order picker lists
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
count, cycle time and WIP, over a work-centre table ranked by **utilization
descending**, the constraint on top; ranking is safe
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
run and 52% over the ticks it worked. Work-centre *names, frozen
capacities and frozen standing rates* come off `/floor`, since `/metrics`
carries ids and a run keeps no copy of the names. The table's Standing cost
column is derived client-side (`windowStandingCostCents`: rate × observed
ticks ÷ `dayTicks`) — display-only, the summed tick columns are the ledger,
and the gap between the column's sum and the opex card is facility overhead.
The window line shows ≈ days via the run's frozen `dayTicks`
(`simTime.ts`, 28,800 fallback).

The page is two persistent control bars (run picking/creation, then
transport: clock, release, fast-forward) over three tabs — **Floor**,
**Trends**, **Dashboard** — named by view shape (a snapshot of now, series
over time, an aggregate over a window), because "Throughput" stopped being an
honest tab name once rate and WIP moved in and "Metrics" overlapped it —
throughput is itself a metric. Every control stays on screen. The floor is
`WorkCenterTable`, one row per centre from `GET /:id/floor` in stable name
order — the floor redraws every tick, so the queue signal is the badge and the
Waiting column, never the row order; the chart tab reads `GET /:id/ticks` and
draws three series from it (cumulative, rate, WIP — see the chart pipeline
below). The table shows the run's **frozen** capacity
read-only — editing the live work center would change nothing about a run
already created — and no "% utilized", which was `slotsInUse / capacity` and
could only read 0% or 100% for a single machine.

### Throughput (money) model

Throughput is measured in **cents**, not parts, and since Track 6A it is only
half the score: a run's `netCents` is throughput minus operating expense minus
carrying cost, computed at read time from frozen columns on both sides. `calculateThroughput` credits `salesOrder.unitPriceCents - part.materialCostCents` for a finished unit only if that unit is covered by an `allocation` linking its work order to a sales order; units beyond the allocated quantity earn nothing. Allocations for a work order are consumed in `id` order, and a unit's position is `priorFinishedCount + alreadyFinishedThisTick`, so **finish order determines which sales order (and price) a unit is credited to**.

The Trends tab draws four series from one `GET /:id/ticks` response,
each in a titled card with a hover hint saying what the chart answers,
each through `TickSeriesChart` (the one recharts wrapper — data plus
formatters, token colours, and an optional named `secondary` line +
`zeroLine`): the stored per-tick money **accumulated**
(`openingCents(history, run.throughputCents)` →
`cumulativeThroughput(history, opening)`) with **cumulative net profit
overlaid on the same axis** (`netPerTick` → the same accumulator, seeded by
`openingNetCents(history, run.netCents)` — the overlay rather than a fourth
card because the gap between the lines is the point, and net crossing the
dashed zero is the run turning profitable), the money as a **trailing
rate** in cents per simulated minute (`throughputRate`, 60-tick window — the
successor to the deleted `smoothThroughput`), and per-tick **WIP** as a step
line straight off `wipCount`. For the cumulative curve the **opening balance
is not optional**. `/ticks` keeps only the newest 5000
rows, so past tick 5000 the series is a *suffix* of the run and a curve
accumulated from zero re-bases and contradicts the money in the line above it
— one fast-forward press reaches that. It is exact rather than approximate
because a tick's `throughputCents` is the sum of its parts' credits and the
run's total is the sum of the same frozen per-part columns, so what the run
earned before the window is the total minus the window's own sum, and no API
change is needed. It floors at zero: the summary and the series are two
requests, and an advance landing between them leaves the window holding money
the total has not counted yet. `openingNetCents` is the same identity for the
net curve with the floor deliberately **absent** — net before the window can
legitimately be negative, and clamping would redraw a loss as break-even.

The rate and WIP series are local by construction, so the suffix needs no
opening correction for them — but the cap does create a *left edge*:
`throughputRate` divides points earlier than the window into the series by
the ticks actually covered, never by the full window, because the data before
a suffix isn't zero, it's absent, and a full-window divisor would draw a fake
ramp at the start of every fast-forwarded chart.

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
