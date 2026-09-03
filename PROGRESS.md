# Build progress

Operational ledger for the road to the AI agent. The README holds the narrative
ten-phase arc; this file answers "what do I do next" in one screen.

**One unit = one commit = one review checkpoint.** Tick a box in the same commit
that completes it.

---

**You are here:** Tracks 1 and 2 done — the backend owns the engine and the
tick reports what each work center did while it ran. Track 3 in progress: 3.1
and 3.1b landed the schema and migration for run persistence, eight tables, and
established the invariant that **a run reads its own config and never the live
factory tables again**. The tables exist but nothing writes them; the frontend
still runs its own copy of the engine until 3.4 deletes it.

**Next up:** 3.2a — `creditFinishedParts`. `run_finished_parts` has per-part
money columns and `calculateThroughput` returns only a tick total, computing the
per-part attribution internally and discarding it. Split it: the new function
returns a credit per finished part and `calculateThroughput` becomes a sum over
it, so the existing throughput tests stand as the contract on the sum. Then 3.2,
the run service.

**Shortest path to an agent** (asked 2026-09-03): 3.2a → 3.2 → 3.3 gets an HTTP
API an agent can drive; Track 6 is what makes driving it mean anything, because
money only goes up today and "release everything" wins by default. Skippable
until after the agent: 3.4, 3.5, Track 5, and most of Track 4 (fast-forward
falls out of 3.2's load-once/write-once design). Track 7 forking is *not*
load-bearing either — two runs from the same seed and config with different
policies is already a valid comparison, since the RNG is a pure hash.

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
- [x] 2.3 Cycle time. **Decided:** `releasedAtTick` goes on `WipPart` and is
      carried onto `FinishedPart` at finish, rather than living on
      `run_released_orders` as a per-work-order release tick. The two are equal
      today — a work order's parts are all instantiated at one release — but the
      part-level field survives batch splitting and per-part release, and keeps
      cycle time out of a join. `aggregateCycleTime` takes only the finished
      records, windowed by the caller on `completedAtTick`, independently of the
      tick series. **Decided:** report a median and a 95th percentile beside the
      mean, by nearest rank so every figure is a cycle time some part actually
      had — a due date is missed by the tail, and one late part drags a mean
      well past the typical part. **Decided:** an empty input returns *nulls*,
      not the zeroes `aggregateMetrics` reports, because "nothing finished" is
      not a cycle time of zero — and zero is itself reachable, since a part
      stranded by a shortened routing finishes on the tick it is seen. A
      negative cycle time throws, as a corrupt run.

**Decided for Track 3.1** (settled here so the migration isn't designed blind):
Track 2 persists nothing, but its shapes dictate the columns. `run_ticks`
becomes `(run_id, tick_num, throughput_cents, wip_count)`, and per-center
occupancy lands in a new `run_tick_work_centers`
`(run_id, tick_num, work_center_id, busy, queued)`. `run_wip_parts` and
`run_finished_parts` each gain `released_at_tick`. Rejected: running
accumulators on the run row — cheaper to write, but lifetime averages only, and
Phase 6 explicitly wants a window.

**Deferred to Track 6:** WIP valued in money (material cost tied up on the
floor) and any per-centre cost rate. Pulling them forward means guessing at the
cost model. 2.2 reports WIP as a count.

## Track 3 — Run persistence (`feat/run-persistence`)

Where a run becomes a server-side object an agent can address.

- [x] 3.1 Schema + migration — six tables. `run_routing_steps` was the open
      decision below and is **decided: snapshot** (2026-09-03), so the count
      went from five to six.
      - `simulation_runs` — name, status, `tick_num`, `rng_seed`, plus
        `parent_run_id` / `forked_at_tick` reserved for Track 7.
        **Decided:** `parent_run_id` is RESTRICT, not SET NULL — a fork exists
        to be compared against what it branched from, so a child left pointing
        at nothing with a `forked_at_tick` it can no longer interpret is worse
        than refusing the delete. `status` is `idle` | `advancing` | `failed`
        and is the **advance lock**: 3.2 loads, ticks N times in memory and
        writes once, so two overlapping advances would each write a batch
        computed from the same starting state. 3.2 is its writer; nothing sets
        it yet, which is the one thing this unit knowingly left dangling.
      - `run_wip_parts` — run CASCADE, `part_uuid` (the `uuid` column type, and
        a draw key), `work_order_id` RESTRICT, `step_index`, progress + actual
        time, `UNIQUE(run_id, part_uuid)`. **No `work_center_id`** — derive it
        from the routing the engine already holds in a Map each tick. Storing it
        adds a 500 path on work-centre delete that doesn't exist today. **No
        `routing_id`** — `work_orders.routing_id` is already RESTRICT, so it
        buys nothing.
      - `run_finished_parts` — append-only, `completed_at_tick`, plus **frozen
        money columns** (`throughput_cents`, `sales_order_id`,
        `unit_price_cents`, `material_cost_cents`) captured at finish time.
        Allocations mutate — they cascade with sales orders and are recreated by
        every new work order — so without freezing, deleting a sales order
        silently rewrites a finished run's chart, since `calculateThroughput`
        skips missing records and credits $0 rather than failing. Indexed on
        `(run_id, completed_at_tick, id)`, not id alone. **Decided:**
        `sales_order_id` is SET NULL and nullable — null already means
        *uncovered*, the frozen cents are what the chart reads, so a deleted
        order costs the run only the ability to name the buyer, whereas RESTRICT
        would let one finished run hold the whole order book hostage.
        `unit_price_cents` is null exactly when `sales_order_id` is;
        `material_cost_cents` is known either way and is what Track 6 values WIP
        at.
      - `run_ticks` — `(run_id, tick_num, throughput_cents, wip_count)`, PK on
        `(run_id, tick_num)`, plus `run_tick_work_centers` `(run_id, tick_num,
        work_center_id, busy, queued)`; see Track 2's decision note for why. The
        chart reads this. Do **not** plan to recompute it from
        `run_finished_parts`. **Decided:** `run_tick_work_centers` keys the tick
        (a composite FK to `run_ticks`, cascading through to the run, named
        explicitly because drizzle-kit otherwise generates a random suffix that
        churns on regeneration) but leaves `work_center_id` **un-keyed** — these
        are historical observations, so cascading would erase a finished run's
        utilization when a centre is retired, and RESTRICT would add the same
        500 path `run_wip_parts` avoids.
      - `run_released_orders` — `(run_id, work_order_id)`, and that pair is the
        primary key rather than a UNIQUE beside a serial: it *is* the identity.
        Guards double-release (`releaseOrder` has no guard today, and persisted
        phantom parts would accrue real carrying cost in Track 6) and defines
        which orders a run owns. No release tick here — 2.3 put it on the part.
      - `run_routing_steps` — `(run_id, routing_id, sequence, work_center_id,
        process_time_seconds)`, PK on the first three, copied into the run on
        first release of a work order using that routing. `setup_time_seconds`
        is omitted, as it is from the engine's `RoutingStep`; `routing_id` and
        `work_center_id` are un-keyed, because the point of a snapshot is to
        outlive edits to what it copied.
      - `npm run seed` now deletes `simulation_runs` first: run parts and
        released orders hold RESTRICT references to work orders, and the cascade
        clears a run's history in one statement.
      - Work-center **capacity** was left read-live here, which retroactively
        moved the utilization denominator for ticks already observed. Settled in
        3.1b: frozen per run.
- [x] 3.1b Re-key the pinned steps and freeze capacity, after talking the fork
      model through (2026-09-03). 3.1 pinned steps per **run**, first release
      winning, which silently made a later release follow an older routing.
      **Decided:** pin per **work order**, at release — `run_routing_steps`
      becomes `run_work_order_steps` keyed `(run_id, work_order_id, sequence)`.
      Editing a routing then affects only releases made after the edit, and two
      work orders off one routing can be following different step lists in the
      same run, which is what `routings.revision` has always implied. Ten work
      orders on an unedited routing means ten identical copies of a few rows —
      cheaper than any scheme that makes a part's steps ambiguous.
      **Decided:** capacity is frozen too, as `run_work_centers
      (run_id, work_center_id, capacity)` copied at run creation — settling the
      question 3.1 deferred. Capacity is the bottleneck lever from the book, so
      it is the first thing a fork will want to change.
      **The invariant this buys:** once a run exists the engine reads run-owned
      config only, never `work_centers` or `routing_steps`. Forking is then a
      copy of rows rather than a versioning scheme bolted on in Track 7.
      **Engine:** `WipPart.routingId` is *gone* — the map is keyed by
      `workOrderId`, which the part already carried, so the re-key removed a
      field instead of adding one. New test: two work orders, two pinned step
      lists, each part following its own.
      **Provenance:** `run_released_orders` gains `routing_id` +
      `routing_revision`, recording what was copied. Nothing reads them to
      decide behaviour, deliberately — `PUT /api/routings/:id/steps` does not
      bump `revision`, so two releases can differ while both saying "A". Fixing
      that writer is a separate call.
      Migration regenerated as one file rather than a correction on top, since
      3.1's was never applied. Also corrected the table count: 3.1 said "six",
      which counted bullet groups, not tables.
      **Still open, one layer up:** a run has no editable *default* config for
      future releases — editing what the next release will pin still means
      editing the live routing, which is shared. Per-run demand (which orders
      exist, what they pay) is unfrozen for the same reason. The money columns
      on `run_finished_parts` already protect completed history, so neither is
      urgent; both are the same freeze-at-a-moment pattern again if needed.
- [ ] 3.2a `creditFinishedParts` — per-part money attribution, split out of
      `calculateThroughput`, which returns a tick total and throws the
      attribution away. `run_finished_parts` cannot be filled without it.
      Pure, so it lands with tests before the service.
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

**Decided, Track 3** (2026-09-03): routings **are** snapshotted into the run at
release time, as `run_routing_steps` in 3.1. `PUT /api/routings/:id/steps`
replaces a routing's steps wholesale, and the docs' claim that an in-flight run
"keeps the routing it was released with" was only ever a frontend caching
accident — a backend engine reading `routing_steps` each tick would re-plan live
parts mid-route, and shortening a list would strand parts past its end (see the
latent bug below). The snapshot makes the documented guarantee real, and is what
Track 7 needs for a fork to mean "same state, new branch". 3.2 owns the
copy-on-release.

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
