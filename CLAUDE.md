# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Factory Flow is a manufacturing simulation platform inspired by Goldratt's _The Goal_: it models production flow to study throughput, WIP, and bottlenecks. The domain vocabulary (throughput = money made through sales, not parts produced) drives the data model, so read `README.md` before changing simulation semantics.

## Repo layout

Two independent npm projects — no workspace/monorepo tooling. Install and run each separately; a change touching both requires two dev servers.

- `backend/` — Express 5 REST API + Drizzle ORM over Neon serverless Postgres
- `frontend/` — Vite + React 19 + Tailwind v4 + React Router; owns the simulation engine

## Commands

```bash
# backend (port 3000; requires backend/.env with DATABASE_URL)
cd backend
npm run dev        # tsx watch src/server.ts
npm run seed       # wipes and reseeds all tables (src/db/seed.ts)
npm run build      # tsc

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
- Each router in `src/routes/` is a default-exported `Router` mounted at `/api/<resource>` in `src/server.ts`. Sales orders and work orders expose `POST` and `DELETE /:id` alongside their GETs; work centers expose `PATCH /:id`.
- Request bodies, path params, and query params are validated with zod schemas in `src/schemas/orders.ts`, applied via `parseOr400` (`src/lib/validate.ts`), which writes a `400 { message }` and returns null so the route early-returns. Every error response in the API is `{ message }`, and the frontend toasts that text verbatim.
- Writes that span tables run in `db.transaction()`; helpers inside a transaction throw `HttpError` (`src/lib/httpError.ts`) to both roll back and carry a status. This is why `db/index.ts` uses the Neon WebSocket `Pool` rather than the HTTP driver, which has no transaction support.
- Allocation rules live in `src/lib/allocate.ts` as pure functions taking plain objects, so they are unit-testable without a database. Allocations for a work order **must** be inserted in one statement, oldest-sales-order-first: ids come out ascending in insert order, and `calculateThroughput` credits finished units in allocation-id order.
- Joins/aggregation are done in JS after separate `db.select()` calls rather than in SQL (see `salesOrders.ts` grouping allocations by sales order, `routings.ts` attaching ordered `steps`).

## Frontend architecture

Routing: `main.tsx` defines the router; `App.tsx` is the layout shell (`NavBar` + `<Outlet/>`, wrapped in `ToastProvider`), with `SimulationPage` at `/` and the order entry module under `/orders` — `OrdersLayout` with `SalesOrdersPage` at `/orders/sales` and `WorkOrdersPage` at `/orders/work`. `/create` was a stub page and now redirects to `/orders/sales`.

`src/api/client.ts` holds the API base URL (still hard-coded `http://localhost:3000` — no env var yet) plus `getJson`/`postJson`/`deleteJson` and `ApiError`, which carries the status and parsed body so callers can branch on a 409 instead of only toasting. `SimulationPage` predates it and still calls `fetch` directly.

`src/data/*.ts` are stale unused fixtures that no longer match the current types. Don't use them as a reference.

### Simulation engine (`src/simulation/`)

All engine logic is pure functions, unit-tested with vitest under a `node` environment (no jsdom, no component tests). `SimulationPage` is the only stateful driver: a `setInterval(…, 1000)` calls `simulateTick` once per real second, so **one tick = one simulated second**.

`simulateTick(wipParts, routings, tickNum)` invariants:

- Every work center has **capacity 1**. Claiming happens in two passes: parts already in service (`progressSeconds > 0`) claim their work center first, then idle parts take whatever centers remain free. Unclaimed parts simply don't advance that tick — queueing is implicit, there is no queue data structure.
- A part completing its last step is pushed to `finishedParts` with `completedAtTick` and marked `stepIndex = -1`, which the final `filter` uses to drop it from WIP.
- On each step transition a fresh `actualProcessTimeSeconds` is drawn from `sampleProcessTime(nominal, 0.3)` — uniform ±30% around the routing's nominal time, floored at 1. This statistical variation is the point of the model, not noise to be removed.

### Throughput (money) model

Throughput is measured in **cents**, not parts. `calculateThroughput` credits `salesOrder.unitPriceCents - part.materialCostCents` for a finished unit only if that unit is covered by an `allocation` linking its work order to a sales order; units beyond the allocated quantity earn nothing. Allocations for a work order are consumed in `id` order, and a unit's position is `priorFinishedCount + alreadyFinishedThisTick`, so **finish order determines which sales order (and price) a unit is credited to**.

The chart pipeline in `SimulationPage` is: per-tick `calculateThroughput` → history capped to the last 120 ticks → `smoothThroughput(history, 60)` (trailing 60-tick mean, dividing by the full window so the ramp-up is intentionally damped) → `cumulativeThroughput` → `ThroughputChart` (recharts).

### React state notes

Fetched data (`routings`, `workOrders`, `parts`, `salesOrders`) is mirrored into refs via `useEffect` because the tick interval's effect depends only on `isRunning`; the interval callback reads `*Ref.current` to avoid restarting the simulation clock whenever data loads. Add new tick-time inputs the same way.

Routings are fetched lazily: `releaseOrder` GETs `/api/routings/:id` for the selected work order, caches it in the `routings` map, and instantiates `order.quantity` WIP parts at step 0 with `crypto.randomUUID()` ids.

## Styling

Tailwind v4 via the `@tailwindcss/vite` plugin — configured through `src/index.css`, with no `tailwind.config.js`.

## Working agreement

The global working agreement in `~/.claude/CLAUDE.md` applies. Project-specific
additions:

- Default unit order for a feature: schema/migration → engine + tests → API → UI.
  Each is its own commit.
- Write tests alongside the code, not after. Tests are the spec for what correct
  means.
- When a change invalidates something documented in this file, update it as part
  of the same commit.
