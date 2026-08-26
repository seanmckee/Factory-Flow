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
- Deletes come in two flavours. Sales and work orders cascade their allocations, so `DELETE` refuses with `409 { message, requiresConfirmation: true, allocations }` and the client re-sends with `?force=true`. Work centers do **not**: `routing_steps.work_center_id` is `ON DELETE RESTRICT`, so a referenced centre can't be removed at all and its 409 deliberately omits `requiresConfirmation` — `deleteConflict()` on the client ignores it and the message lands in the error toast instead of a confirm dialog. Don't add a `?force=` path there without changing the FK.
- Parts carry **both** shapes, because their three foreign keys disagree: `work_orders.part_id` and `sales_orders.part_id` are RESTRICT (hard refusal, no `requiresConfirmation`) while `routings.part_id` is CASCADE (confirmable, `?force=true`). `DELETE /api/parts/:id` checks RESTRICT first — when an order references the part no amount of force helps, so offering a confirm dialog would be a lie. `DeleteConflict` in `api/client.ts` therefore carries `allocations?` and `routings?` as optional per-resource detail.
- Tests run under vitest with `environment: node` (`backend/vitest.config.ts`), the same way the frontend runs the simulation engine — pure functions only, no DB and no HTTP in the suite. `tsconfig.json` sets `"types": []`, so test globals are imported explicitly from `vitest` rather than relied on ambiently. The config's `include` is scoped to `src/**/*.test.ts` because `npm run build` compiles tests into `dist/` too, and an unscoped vitest would collect that stale copy as a second suite.
- Request bodies, path params, and query params are validated with zod schemas in `src/schemas/orders.ts`, applied via `parseOr400` (`src/lib/validate.ts`), which writes a `400 { message }` and returns null so the route early-returns. Every error response in the API is `{ message }`, and the frontend toasts that text verbatim.
- Writes that span tables run in `db.transaction()`; helpers inside a transaction throw `HttpError` (`src/lib/httpError.ts`) to both roll back and carry a status. This is why `db/index.ts` uses the Neon WebSocket `Pool` rather than the HTTP driver, which has no transaction support.
- Allocation rules live in `src/lib/allocate.ts` as pure functions taking plain objects, so they are unit-testable without a database. Allocations for a work order **must** be inserted in one statement, oldest-sales-order-first: ids come out ascending in insert order, and `calculateThroughput` credits finished units in allocation-id order.
- Joins/aggregation are done in JS after separate `db.select()` calls rather than in SQL (see `salesOrders.ts` grouping allocations by sales order, `routings.ts` attaching ordered `steps`).

### Simulation engine (`backend/src/simulation/`)

The backend owns the engine: `types.ts` (narrow structural input types that
Drizzle rows satisfy without mapping), `sampleProcessTime.ts`, `simulationTick.ts`
and `calculateThroughput.ts`. Pure functions, no DB and no HTTP, unit-tested
under `environment: node`. The frontend keeps a copy until it switches over.

Two rules the port established, and both matter to how failures surface:

- Randomness is **not** drawn at call time. `sampleProcessTime` is a pure
  function of `(seed, partId, stepIndex)`, so a run persists a single `rng_seed`
  and nothing else — a replay or a fork reproduces every draw with no cursor to
  restore. Don't reintroduce `Math.random()`.
- A referenced-but-absent record **throws** (a part's routing, a step's work
  center, a finished part's work order, an allocation's sales order). A silent
  zero reads to a fork comparison as a policy that lost money rather than as a
  bug. An *uncovered* unit is different — it legitimately earns nothing.

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

Routing: `main.tsx` defines the router; `App.tsx` is the layout shell (`NavBar` + `<Outlet/>`, wrapped in `ToastProvider`), with `SimulationPage` at `/`, the order entry module under `/orders` — `OrdersLayout` with `SalesOrdersPage` at `/orders/sales` and `WorkOrdersPage` at `/orders/work` — and the factory setup module under `/setup` — `SetupLayout` with `WorkCentersPage` at `/setup/work-centers`, `PartsPage` at `/setup/parts` and `RoutingsPage` at `/setup/routings`. `/create` was a stub page and now redirects to `/orders/sales`.

Both modules follow the same shape: a `*Layout` renders a `*DataProvider` that loads every list the module needs in one `Promise.all` and exposes per-resource refetches, so sibling pages share one fetch and navigating between them doesn't refetch. `SetupDataProvider` loads parts and routings alongside work centers even though only work centers are editable today, because the routing editor will need all three.

`src/api/client.ts` holds the API base URL (still hard-coded `http://localhost:3000` — no env var yet) plus `getJson`/`postJson`/`patchJson`/`putJson`/`deleteJson` and `ApiError`, which carries the status and parsed body so callers can branch on a 409 instead of only toasting. `SimulationPage` predates it and still calls `fetch` directly.

`src/data/*.ts` are stale unused fixtures that no longer match the current types. Don't use them as a reference.

### Simulation engine (`src/simulation/`)

All engine logic is pure functions, unit-tested with vitest under a `node` environment (no jsdom, no component tests). `SimulationPage` is the only stateful driver: a `setInterval(…, 1000)` calls `simulateTick` once per real second, so **one tick = one simulated second**.

`simulateTick(wipParts, routings, tickNum)` invariants:

- A work center runs up to `capacity` parts at once — the column defaults to 1 and is editable from the simulation page, so don't treat 1 as an invariant. Claiming happens in two passes: parts already in service (`progressSeconds > 0`) claim their work center first, then idle parts take whatever machines remain free. Unclaimed parts simply don't advance that tick — queueing is implicit, there is no queue data structure.
- A part completing its last step is pushed to `finishedParts` with `completedAtTick` and marked `stepIndex = -1`, which the final `filter` uses to drop it from WIP.
- On each step transition a fresh `actualProcessTimeSeconds` is drawn from `sampleProcessTime(nominal, 0.3)` — uniform ±30% around the routing's nominal time, floored at 1. This statistical variation is the point of the model, not noise to be removed.

### Throughput (money) model

Throughput is measured in **cents**, not parts. `calculateThroughput` credits `salesOrder.unitPriceCents - part.materialCostCents` for a finished unit only if that unit is covered by an `allocation` linking its work order to a sales order; units beyond the allocated quantity earn nothing. Allocations for a work order are consumed in `id` order, and a unit's position is `priorFinishedCount + alreadyFinishedThisTick`, so **finish order determines which sales order (and price) a unit is credited to**.

The chart pipeline in `SimulationPage` is: per-tick `calculateThroughput` → history capped to the last 120 ticks → `smoothThroughput(history, 60)` (trailing 60-tick mean, dividing by the full window so the ramp-up is intentionally damped) → `cumulativeThroughput` → `ThroughputChart` (recharts).

### React state notes

Fetched data (`routings`, `workOrders`, `parts`, `salesOrders`) is mirrored into refs via `useEffect` because the tick interval's effect depends only on `isRunning`; the interval callback reads `*Ref.current` to avoid restarting the simulation clock whenever data loads. Add new tick-time inputs the same way.

Routings are fetched lazily: `releaseOrder` GETs `/api/routings/:id` for the selected work order, caches it in the `routings` map, and instantiates `order.quantity` WIP parts at step 0 with `crypto.randomUUID()` ids.

### Shared UI primitives

`src/components/ui/` holds the presentational pieces every list page builds
from: `Table`/`THead`/`Th`/`Tr`/`Td`, `FormCard`/`Field`/`SubmitButton`/`inputClass`,
`DeleteButton` and `InlineInput`. Deliberately not data-driven — every table has
conditional cell colouring, computed values and a bespoke last column, so the
JSX structure stays at the call site and only the classes are shared. `Td`
separates `numeric` (right-aligned and tabular) from a plain
`className="text-right"` for cells holding a control; `Table` takes
`framed={false}` when it already sits inside a bordered card.

Ordered-list editing lives in `src/setup/routingSteps.ts` — `moveStep`,
`removeStep`, `parseSteps`, `toDrafts` — pure functions unit-tested like the
simulation engine, with `StepEditor` as the shared UI over them.

## Styling

Tailwind v4 via the `@tailwindcss/vite` plugin — configured through `src/index.css`, with no `tailwind.config.js`.

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
