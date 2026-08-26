# Build progress

Operational ledger for the road to the AI agent. The README holds the narrative
ten-phase arc; this file answers "what do I do next" in one screen.

**One unit = one commit = one review checkpoint.** Tick a box in the same commit
that completes it.

---

**You are here:** Track 1 done — the backend owns the engine: types, a seeded
replayable tick, and the money model. Nothing drives it yet; the frontend still
runs its own copy until 3.4 deletes it. 1.1 shipped in `feat/engine-to-backend`;
1.2–1.3 in `feat/engine-to-backend-tick`. 1.0 shipped on its own branch because
it is a frontend refactor, not part of the move. Track 2 is most of the way:
the tick reports what each work center did while it ran, and a window of those
observations reduces to utilization, queue depth and WIP.

**Next up:** Track 2, unit 2.3 — cycle time.

---

## Why this order

The agent needs to run experiments, not narrate them. That requires a simulation
it can drive (today it only exists inside a browser tab) and a score that can go
down (today throughput only goes up, so "release everything" always wins).

Engine to the backend → instrument it → persist runs → fast-forward → see it →
let the factory lose money → fork and compare → agent.

## Unit 0 — Ledger

- [x] `docs/build-ledger` — this file + the `CLAUDE.md` pointer

## Track 0 — Infrastructure

Own branches, own commits. Both block putting engine code and tests in the backend.

- [x] `chore/backend-outdir` — `rootDir`/`outDir` are commented out in
      `backend/tsconfig.json`, so `tsc` emits ~60 `.js`/`.d.ts`/`.map` files into
      `src/` and `npm start` can't work. Must land before vitest, which would
      otherwise pick up emitted `*.test.js` as duplicate suites and make
      `tsx watch` restart on its own output.
- [x] `chore/backend-vitest` — backend has no test runner at all. `environment:
      node`, mirroring the frontend. Note `"types": []` in tsconfig: import test
      globals explicitly.

## Track 1 — Engine to the backend (`feat/engine-to-backend`)

Move before instrumenting, so new engine code isn't written in the frontend and
immediately relocated. The backend owns the engine; the frontend keeps
hand-written type mirrors, as it already does for every API shape. No workspace
tooling — the two tsconfigs are actively incompatible (frontend is `bundler` +
**`strict` off**, backend is `nodenext` + strict + `noUncheckedIndexedAccess`).

- [x] 1.0 Refactor `calculateThroughput` to take `Map<workOrderId, priorCount>`
      instead of the whole finished history. **Frontend, under the existing
      tests**, before anything moves — it's O(n²) today and it's what would force
      a persisted run to reload its entire history every tick.
- [x] 1.1 `backend/src/simulation/types.ts` — a retyping, not a copy. The Drizzle
      types are different shapes. **Decided:** narrow structural types carrying
      only the fields the engine reads, so Drizzle rows satisfy them without
      mapping; `FinishedPart` split out of `WipPart` in place of the
      `stepIndex: -1` sentinel; `routingId` stays on the in-memory `WipPart`
      (hydrated from the work order) though it is not a stored column;
      allocations stay flat, as in the table, rather than nested under sales
      orders as the API returns them.
- [x] 1.2 Port `sampleProcessTime` + `simulateTick` + tests. Strip the per-draw
      `console.log`. **Seed the RNG here** (decided 2026-08-22): `rng_seed` on
      the run, or make the draw a pure function of `(seed, part_uuid,
      step_index)` so it needs no persisted cursor. Without this, Track 7's fork
      comparison measures noise rather than the decision that changed.
      **Decided:** the pure `(seed, part_uuid, step_index)` form — stateless, so
      a run stores only `rng_seed` and a fork replays exactly with nothing to
      restore. Also decided: a part whose `stepIndex` has run past the end of a
      shortened routing (the latent bug below) **finishes at the current tick** —
      the removed work no longer exists, so it is credited normally rather than
      freezing in WIP or vanishing. **Decided during the port:** a missing
      routing or work center **throws** rather than logging and skipping as the
      frontend does — it is a loader bug or a corrupt run, and with Track 3
      advancing N ticks per transaction, failing loudly rolls the batch back
      instead of silently freezing parts that Track 6 would charge rent on.
- [x] 1.3 Port `calculateThroughput` + tests. Don't port `smoothThroughput` —
      dead code, superseded by Track 5. **Decided:** a record that is referenced
      but absent (the finished part's work order, that work order's part, an
      allocation's sales order) **throws**, as in 1.2 — the agent compares runs
      on money, and a silent zero reads to it as a policy that lost money rather
      than as a bug. An *uncovered* unit is not a missing record and still earns
      zero; deleting a sales order cascades its allocations away, so it surfaces
      as uncovered units rather than as a dangling reference, and advancing a
      live run keeps working.

## Track 2 — Instrumentation (`feat/simulation-metrics`)

The "observations" half the agent needs. Today the only observation is money.

Split into three units (decided 2026-08-25), not the two originally listed.
**Decided:** metrics are *emitted by the tick*, not generalised out of
`deriveWorkCenterView` as this file previously said. That function is a
post-tick snapshot of `wipParts`, and a part that finished during the tick held
a machine for all of it yet is gone from the list by the time a snapshot looks —
so a centre's busiest ticks are exactly the ones it undercounts. It also can't
tell an admitted part from a mid-process one without duplicating the claim
passes, and instantaneous `slotsInUse / capacity` can only ever read 0, ½, 1,
which cannot answer "how busy was the drill press over the last 500 ticks".
`simulateTick` already computes all of it and threw it away.

- [x] 2.1 `SimulationTickResult.metrics` — `wipCount` plus per-work-center
      `busy` / `queued`, read off the `inUse` / `inService` state the two claim
      passes already build. **Decided:** one entry per work center *including
      idle ones* (a centre at 0/0 is an observation, and Track 6 charges it rent
      either way) so the denominator doesn't move as centers drop in and out of
      the series; `busy` counts *machines*, not parts, because it is what
      divides by `capacity`; a part stranded past a shortened routing counts as
      neither, matching 1.2's rule that it holds no machine on the way out;
      `wipCount` is emitted despite equalling `wipParts.length` because WIP is
      mutable state — no stored table can say what it was at tick 300.
- [x] 2.2 `metrics.ts` — `aggregateMetrics(series, workCenters)` over a
      `TickMetrics[]` window: utilization, mean and worst queue depth, mean,
      peak and final WIP. **Decided:** windowing is the *caller's* job (a
      `WHERE tick_num BETWEEN`, or a slice) and this aggregates exactly what it
      is handed — the same function then serves a live batch and a stored range
      without a second code path. **Decided:** `tickNum` moved onto
      `TickMetrics` (amending 2.1) so a batch of 500 observations is stored and
      read back as rows keyed by tick without zipping against a separate list.
      **Decided:** the utilization denominator is per-centre `observedTicks`,
      not the window's tick count — a work center created mid-run has no
      observations before it existed, and dividing those in reports it idle for
      time it did not exist. **Decided:** an empty window returns zeroes and
      null bounds rather than throwing; a run that has never advanced
      legitimately has no ticks. Also fixed the now-false "every work center has
      capacity 1" line in `CLAUDE.md` and the README (both engines have always
      honoured the column; 1 is only its default), the stale claim that the
      frontend owns the engine, and the "work centre capacity > 1" entry in the
      README's still-to-build list.
- [ ] 2.3 Cycle time. **Decided:** `releasedAtTick` goes on `WipPart` and is
      carried onto `FinishedPart` at finish, rather than living on
      `run_released_orders` as a per-work-order release tick. The two are equal
      today — a work order's parts are all instantiated at one release — but the
      part-level field survives batch splitting and per-part release, and keeps
      cycle time out of a join.

**Decided for Track 3.1** (settled here so the migration isn't designed blind):
Track 2 persists nothing, but 2.2's shape dictates the columns. `run_ticks`
becomes `(run_id, tick_num, throughput_cents, wip_count)`, and per-center
occupancy lands in a new `run_tick_work_centers`
`(run_id, tick_num, work_center_id, busy, queued)`. Rejected: running
accumulators on the run row — cheaper to write, but lifetime averages only, and
Phase 6 explicitly wants a window.

**Deferred to Track 6:** WIP valued in money (material cost tied up on the
floor) and any per-centre cost rate. Pulling them forward means guessing at the
cost model. 2.2 reports WIP as a count.

## Track 3 — Run persistence (`feat/run-persistence`)

Where a run becomes a server-side object an agent can address.

- [ ] 3.1 Schema + migration — five tables:
      - `simulation_runs` — name, status, `tick_num`, `rng_seed`, plus
        `parent_run_id` / `forked_at_tick` reserved for Track 7.
      - `run_wip_parts` — run CASCADE, `part_uuid`, `work_order_id` RESTRICT,
        `step_index`, progress + actual time, `UNIQUE(run_id, part_uuid)`.
        **No `work_center_id`** — derive it from the routing the engine already
        holds in a Map each tick. Storing it adds a 500 path on work-centre
        delete that doesn't exist today and forces
        `PUT /api/routings/:id/steps` to mutate live runs. **No `routing_id`** —
        `work_orders.routing_id` is already RESTRICT, so it buys nothing.
      - `run_finished_parts` — append-only, `completed_at_tick`, plus **frozen
        money columns** (`throughput_cents`, `sales_order_id`,
        `unit_price_cents`, `material_cost_cents`) captured at finish time.
        Allocations mutate — they cascade with sales orders and are recreated by
        every new work order — so without freezing, deleting a sales order
        silently rewrites a finished run's chart, since `calculateThroughput`
        skips missing records and credits $0 rather than failing. Order by
        `(completed_at_tick, id)`, not id alone.
      - `run_ticks` — `(run_id, tick_num, throughput_cents, wip_count)`, plus
        `run_tick_work_centers` `(run_id, tick_num, work_center_id, busy,
        queued)`; see Track 2's decision note for why. The chart reads this. Do
        **not** plan to recompute it from `run_finished_parts`.
      - `run_released_orders` — `(run_id, work_order_id)` UNIQUE. Guards
        double-release (`releaseOrder` has no guard today, and persisted phantom
        parts would accrue real carrying cost in Track 6) and defines which
        orders a run owns.
- [ ] 3.2 Run service. **Never persist per tick** — load once, advance N ticks in
      memory, write once per batch, one transaction. Neon over a WebSocket pool
      makes every write a round trip; per-tick writes make Track 4 impossible.
- [ ] 3.3 Routes — create / list / get / release / advance / delete.
      **Open decision:** what "reset" means, and `work_orders.status` has never
      had a writer.
- [ ] 3.4 Frontend switchover **and** deletion of the frontend engine, one
      commit, so two engines never coexist untested. `cumulativeThroughput.ts`
      stays — it's a chart transform, not physics.
- [ ] 3.5 Update `CLAUDE.md` and the README's "entirely ephemeral" limitation.
      Document that a crash loses at most one batch of ticks.

**Open decision, Track 3:** snapshot routings into the run at release time
(`run_routing_steps`)? `PUT /api/routings/:id/steps` currently claims an
in-flight run "keeps the routing it was released with" — but that is a frontend
caching accident, and it evaporates the moment the backend engine re-reads
`routing_steps` each tick, so the guarantee in the docs becomes false during
this track. A snapshot is the real fix and is what Track 7 forking needs anyway
("same state, new branch"). Deferrable, but decide it deliberately.

## Track 4 onward — re-plan when reached

- [ ] Track 4 `feat/run-fast-forward` — `advance {ticks: N}`, speed control.
      Running 5000 ticks instantly is what makes the agent viable.
- [ ] Track 5 `feat/run-dashboard` — metrics UI. Fold in the deferred
      throughput-chart work: the cumulative flatline bug, then rate + WIP series.
- [ ] Track 6 `feat/operating-expense` — cost accruing against simulated time,
      carrying cost, P&L. **This is what makes the agent's objective
      non-degenerate.**
- [ ] Track 7 `feat/run-forking` — fork at a checkpoint, compare on net profit.
      Depends on the seeded RNG from 1.2.
- [ ] Track 8 `feat/agent` — tool layer: create, advance, fork, read metrics,
      compare.

## Known latent bug

Shortening a routing's step list strands in-flight parts with
`stepIndex >= steps.length`. The frontend's `simulationTick.ts` indexes
`steps[stepIndex]` at four sites with no guard and has `strict` off, so this is
a live crash reachable through the routing editor. The backend port handles it
(1.2: the stranded part finishes at the current tick), but the frontend engine
keeps the bug until 3.4 deletes it.
