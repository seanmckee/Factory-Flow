# Build progress

Operational ledger for the road to the AI agent. The README holds the narrative
ten-phase arc; this file answers "what do I do next" in one screen.

**One unit = one commit = one review checkpoint.** Tick a box in the same commit
that completes it.

---

**You are here:** **Track 5 (run dashboard) is complete, awaiting a browser
pass.** The Dashboard tab is a real dashboard — stat cards over a work-centre
table ranked by utilization, with window controls — and the Trends tab draws
three series: cumulative money, trailing rate, and WIP, each with a hover
hint saying what the chart answers.

**Next up:** Track 6A (operating expense / P&L core), planned 2026-09-03 — see
the Track 6 section for the sub-track split and the time model. Track 6 is what
makes the score able to go down and so what makes an agent's objective
non-degenerate.

**One refactor unit first — done** (decided and landed 2026-09-03): the read
side of `runService.ts` — `listRuns`, `getRun`, `getRunMetrics`, `getRunFloor`,
`getRunTicks`, plus `tickWindow` and the read types — moved to `runReads.ts`,
and `loadRunState` (shared by `advanceRun` and `getRunFloor`) to `runState.ts`,
so neither side imports the other. No behavior change, no new tests (nothing
pure moved). Track 6's P&L reads and Track 7's comparison reads belong on that
side of the line however the rest is eventually carved. Deeper carving, and the `SimulationPage` hooks (`useRunClock`,
`useRunJump`), wait until after Track 7 — boundaries invented ahead of the code
that uses them are the ones you end up fighting.

**Shortest path to an agent** (asked 2026-09-03): 3.2a → 3.2 → 3.3 gets an HTTP
API an agent can drive; Track 6 is what makes driving it mean anything, because
money only goes up today and "release everything" wins by default. Skippable
until after the agent: 3.4, 3.5, Track 5, and most of Track 4 (fast-forward
falls out of 3.2's load-once/write-once design — Track 4 turned out to be a UI
track, since the API half shipped with 3.2/3.3). Track 7 forking is *not*
load-bearing either — two runs from the same seed and config with different
policies is a valid comparison, **which is true only because of 3.2b**; before
it, independently created runs drew different noise.

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
- [x] 3.2a `creditFinishedParts` — per-part money attribution, split out of
      `calculateThroughput`, which returned a tick total and threw the
      attribution away, so `run_finished_parts`' frozen money columns could not
      be filled at all. **Decided:** `calculateThroughput` becomes the *sum* of
      the new function rather than a parallel implementation — the chart reads
      the total and the run stores the parts, and two code paths would
      eventually disagree about what a run earned. All 73 existing throughput
      tests passed unchanged, which is the contract on the sum; five new ones
      cover the per-part shape, including two units straddling an allocation
      boundary in one tick and so selling at different prices.
      **Decided:** an uncovered unit gets `salesOrderId` and `unitPriceCents`
      null together with `throughputCents: 0`, but keeps its
      `materialCostCents` — the money was spent, and Track 6 prices carrying
      cost off it. `FinishedPartCredit` lives in `calculateThroughput.ts` beside
      its producer, as `TickMetrics` does in `simulationTick.ts`.
- [x] 3.2 Run service. **Split across the pure/impure line**, which the ledger
      hadn't anticipated: `simulateBatch` in `src/simulation/` is a pure
      function from `RunState` + tick count to a `RunBatch` (surviving WIP,
      finished records with frozen money, a `TickRecord` per tick, advanced
      `priorCounts`), and `src/lib/runService.ts` only loads, calls it and
      writes. **Decided** because the suite is pure-functions-only: putting the
      loop in the service would have left every decision it makes — money
      attribution, count carry-over, row shaping — permanently untestable.
      `runService` now holds no arithmetic at all.
      **Decided:** `priorCounts` advances within a batch and is carried out of
      it, so a unit finishing at tick 5 is priced against the allocation after
      the one covering a unit that finished at tick 3, and a long advance runs
      as several batches without re-reading the counts. A test asserts a run
      advanced in one batch of 30 and in three of 10 produces identical
      finished parts and tick rows — which is what makes chunking safe and what
      a fork will replay.
      **Decided:** 500 ticks per batch, one transaction each, so a crash costs
      at most one batch; inserts split at 1000 rows, because Postgres caps bind
      parameters near 65535 and 500 ticks of a twenty-centre factory is ten
      thousand per-centre rows.
      **Decided:** releasing takes the same lock as advancing. An advance
      replaces the run's WIP rows wholesale, so a release landing mid-batch
      would be silently deleted by the write that follows it. The lock is a
      conditional `UPDATE ... WHERE status = 'idle'`, deliberately outside the
      caller's transaction — a lock nobody can observe until commit is not a
      lock — which is exactly why a dead process leaves a run held and 3.3 owes
      it a reset.
      **Decided:** no `failed` status. Work commits or rolls back, so a run is
      consistent either way and returns to `idle`; a state nothing ever writes
      is worse than not having it.
      **Decided:** `priorCounts` loads as a `GROUP BY` count, not by reading
      the finished history back — the whole point of 1.0's refactor. The one
      place this deviates from the JS-aggregation convention, and deliberately.
      **Not exercised yet:** `runService` has never run. 20 tests cover
      `simulateBatch`; the service is typechecked only, and 3.3 is its first
      execution.
- [x] 3.2b Fix the draw key, found by smoke-testing 3.2 against the dev
      database (2026-09-03). Two runs created with the same seed and the same
      release produced different completion ticks: the draw key was
      `(seed, partUuid, stepIndex)` and part uuids are minted fresh at every
      release, so **the seed never determined a run**. 1.2's claim that "a run
      stores only `rng_seed` and a fork replays exactly" was true only for a
      fork, which copies parts and so keeps their uuids — a re-creation drifted,
      and comparing two independently created runs measured the dice rather
      than the decision, which is the exact failure seeding was introduced to
      prevent.
      **Decided:** the key becomes `(seed, workOrderId, unitIndex, stepIndex)`.
      `WipPart` gains `unitIndex`, stored as `run_wip_parts.unit_index`, and
      the uuid stays as row identity only. `UNIQUE(run_id, work_order_id,
      unit_index)` makes the key name exactly one part; the double-release
      guard is what makes that hold. The run id is deliberately **not** in the
      key — two runs agreeing on their noise is the point.
      **Not fixed the same way:** deriving a deterministic uuid instead. It
      hides the key in an opaque string and still needs the unit index to
      compute, so it is the same column with worse ergonomics.
      Verified against the database: two runs, same seed, entirely different
      uuids, identical completions (19,23,26,30,35) and identical money.
      **A test that gave false confidence:** `reproduces a run's draws from the
      seed alone` passed the *same* uuid on both replays, so it could never
      have caught this. The property now lives where it failed — `simulateBatch`
      asserts two states with different part ids produce identical batches.
      **Watch for:** two parts of one work order now differ only by
      `unitIndex`, so a fixture giving both index 0 makes them move in
      lockstep. That is what broke `draws independently per part` in
      `simulationTick.test.ts`, whose parts are now numbered as a release
      numbers them.
- [x] 3.3 Routes — `src/routes/runs.ts`, the only router with no DB code in it;
      `runService` owns the loading, the lock and the writes.
      **The open decision on "reset" is resolved: there isn't one.** Two things
      were hiding under the word. Clearing a lock a dead process left is real
      and is `POST /:id/unlock`, the only way out of `advancing` since the lock
      is deliberately non-transactional. Rewinding a run to tick 0 is *not*
      needed at all — 3.2b made a run reproducible from its seed, so deleting
      and re-creating it gives the same run back. (Caveat: it re-copies the
      *current* factory config, so a run started before a capacity edit is not
      recoverable that way. Forking will be the answer if that ever matters.)
      **`work_orders.status` stays unwritten, and that is now a decision, not
      an omission:** a release is per-run, so one global column cannot say
      whether a work order is running. `run_released_orders` is the truth.
      **Decided:** `ticks` is capped at 20000 per request. Advancing is
      synchronous at ~500 ticks/second, so an uncapped request would hold a
      connection for minutes with nothing to show; a caller wanting more calls
      again, a run being resumable by construction.
      **Beyond the ledger's list:** `GET /:id/metrics?fromTick&toTick`, because
      an agent that cannot read observations cannot experiment. It passes the
      bounds down rather than slicing one series, since flow and cycle time
      window on different columns by the engine's contract.
      **Decided:** deleting a run needs no `?force=true` — a run owns
      everything that cascades from it, so nothing outside it is lost. A run
      another was forked from is a hard 409 with no confirm path, since losing
      the baseline a comparison is against is not something to confirm past.
      Also renamed the private `routingText` zod helper to `boundedText`, now
      that a run name uses it too.
      **Exercised over HTTP against the dev database**, which is the first time
      `runService` ran at all: create with and without a seed, validation
      failures, release, double release 409, unknown work order 404, the tick
      cap 400, advance 200 and 3000 ticks, run summary with frozen money,
      metrics over the whole run and over a window (wc51 reads 10% utilization
      run-wide and 52% in the busy window — the bottleneck is only visible in
      the right window), a backwards window 400, unlock, list, delete 204, and
      404s throughout. **Two concurrent advances: one 200, one 409. A release
      during an advance: 409** — the silent data loss the shared lock exists to
      prevent. Server log clean.
- [x] 3.4a Floor and tick-series reads, split out of 3.4 because the switchover
      needs two things the API didn't expose: the per-machine progress the
      cards draw, and the per-tick money series the chart plots.
      `deriveFloorView` is the frontend's `deriveWorkCenterView` ported the way
      the engine was — pure, with tests — and it **fixes the latent crash on
      the way**: the frontend indexed `steps[stepIndex]` unguarded, so a part
      stranded past a shortened route crashed the page; here it is simply on no
      machine, matching the rule the tick applies.
      **Decided:** `WorkCenterFloorView` has no `utilization`. An instantaneous
      `slotsInUse / capacity` reads only 0, half or 1, and naming it
      utilization invites it being read as the answer `aggregateMetrics` gives
      over a window. Confirmed live: a center showed `slotsInUse: 0` having
      held a part for the whole of that tick, the part having finished its step
      and moved on — the exact undercount 2.1 rejected a snapshot for.
      **Decided:** work center *names* come from the live table, the one thing
      a run keeps no copy of. Renaming a center is cosmetic, and a run showing
      the current name is right; capacity and steps still come from the run.
      **Decided:** `/ticks` is capped at 5000 rows rather than paged, keeping
      the *newest* in the window — more points than a screen has pixels, and a
      chart following a live run wants the end of the series.
      Exercised over HTTP: floor at tick 0 and mid-run (`Drill Press 2/2
      slots=[67, 50]`, 16 parts queued at Raw Material), the series whole and
      windowed, and 404s.
- [x] 3.4 Frontend switchover **and** deletion of the frontend engine, one
      commit, so two engines never coexist untested. `simulationTick.ts`,
      `calculateThroughput.ts`, `sampleProcessTime.ts`, `smoothThroughput.ts`
      (already dead) and both their test files are gone, along with
      `types/WipPart.ts` and `WorkCenterView`. `cumulativeThroughput.ts` stays
      — a chart transform, not physics.
      The page now picks or creates a run, releases into it and advances it a
      tick a second over HTTP, holding no simulation state: a reload resumes
      the same run, and stopping is client-side only, so switching runs parks
      one and resumes another exactly where it stopped.
      **Decided:** an `advancing` ref skips a beat rather than queueing when a
      request is still in flight. The server lock makes an overlapping advance
      a 409, and the interval is a display clock, not a queue.
      **Decided:** capacity on the cards is read-only, and the "% utilized"
      figure is gone. A run's capacity is frozen, so editing the live work
      center would have changed nothing on screen — a knob that does nothing is
      worse than no knob — and `slotsInUse / capacity` on one machine can only
      read 0% or 100%, which is not what utilization means.
      **Decided:** `DELETE /api/runs/:id` returns `200 { id, name }`, not 204,
      matching every other delete in the API, because the client's `deleteJson`
      parses a body. A correction to 3.3.
      **Bug found by driving it in a browser, fixed here:** every call on a
      *fresh* run 400'd with "toTick 0 is before fromTick 1". Ticks number from
      1, so a run at tick 0 spans nothing, and both aggregates already answer
      an empty window with zeroes and nulls — the guard was wrong, not the
      request. Only a window the caller explicitly asks for backwards is a 400
      now. **Every curl test had run against runs that had already advanced**,
      so nothing headless would have caught it; the lesson is that "create then
      read" is its own case.
- [x] 3.5 Doc sweep. `CLAUDE.md` was kept current unit by unit, so this is the
      README: the "entirely ephemeral" limitation is **closed** and replaced by
      what persistence actually bought (a run resumes, a crash loses at most one
      batch of 500 ticks, a run freezes the factory it started with, a run is
      reproducible from its seed) — plus what is **still** ephemeral, which is
      the order book: prices are read live, so completed history is safe but
      editing demand mid-run changes what later units are worth.
      Also corrected: the frontend engine copy (deleted), the trailing-mean
      chart pipeline (gone), and "nothing displays it yet" for metrics (now
      readable over the API, no dashboard until Track 5). Phases 1-3 marked
      delivered or partly delivered, with what is missing named — Phase 2 has
      no unattended clock and no speed control; Phase 3 has the time series but
      no event log.
      **Three of the README's open questions moved to answered**, kept on the
      page because the answers shaped what came after: where the tick loop
      lives (the server, in batches; the browser interval is a display clock),
      snapshot granularity (per tick for observations, WIP replaced wholesale
      per batch), and master data versioning (runs pin, per *work order* at
      release). "Explicit queues" was narrowed rather than deleted: queue depth
      is measured now, but queueing is still implicit in the engine, so there
      is nothing to reorder or prioritise. Two questions were added: whether a
      run should be able to edit its own config, and it is noted that forking
      needs less than the README assumed — a seeded run can be copied rather
      than replayed from a log.

## Track 4 — Fast-forward (`feat/run-fast-forward`)

The API half shipped with 3.2/3.3: `advance {ticks: N}` has run 5000 ticks in
one call since then, so nothing an agent needs was outstanding. What was left
was the human half — a way to jump a run forward and something worth reading at
the far end.

**Decided up front:** no speed multiplier, and no unattended clock. A run is
fast-forwarded to see where it goes, not watched going faster, and a "100×"
button lies the moment the multiplier outruns ~500 ticks a second. Phase 2's
unattended clock and calendar stay unbuilt: they would put the first stateful
thing in the Express process, and an agent drives `advance` explicitly and
wants determinism, not a background loop racing it.

- [x] 4.1 `AdvanceResult.wipCount` — what a jump running until idle terminates
      on. Free: the surviving WIP is `state.wipParts.length` after the last
      batch, not a query.
      **Decided:** terminate on the advance's own answer, not on a follow-up
      `GET /:id` — a read chasing each chunk could already be a batch stale,
      and with it the jump loop makes no other request at all.
- [x] 4.2 `openingCents` + a seeded `cumulativeThroughput`, with tests, and the
      page wired to them. `/ticks` keeps the newest 5000 rows, so past tick
      5000 the chart's series is a *suffix* of the run and a curve accumulated
      from zero re-based and contradicted the money in the line directly above
      it. Landed **before** 4.3, since one press of a jump button reaches tick
      5000.
      **Decided:** seed it client-side as `run.throughputCents − Σ(window)`
      rather than adding a cumulative column or endpoint. It is exact, not an
      approximation: a tick's throughput is the sum of its parts' credits and
      the run's total is the sum of the same frozen per-part columns, so the
      two agree by construction. Floored at zero, because the summary and the
      series are two requests and an advance between them leaves the window
      holding money the total has not counted.
      The whole track's test surface, and the only pure code in it.
      Confirmed live: a run at tick 7100 had earned $930 while the 5000 rows
      `/ticks` returned (2101–7100) held $0 of it — the old curve drew a flat
      line at zero under a summary reading $930.
- [x] 4.3 Jump controls, `SimulatingOverlay`, clock interlock. `100 / 500 /
      1000` and Run until idle, chunked at 500 to match `TICKS_PER_BATCH`,
      ceiling of 100000 ticks on until-idle.
      **Decided:** Stop halts dispatching and never aborts in flight. The
      server commits that batch either way, so aborting would save a second
      and leave the page claiming a tick the run had passed; halting instead
      makes every stopped jump a real resumable state, which is exactly what
      3.2's load-once/write-once design bought.
      **Decided:** the overlay shows **progress only** — no metrics. It is up
      for a second or two, and a figure that appears and vanishes cannot be
      checked. Stop is the only live control in it: an until-idle jump can run
      to its ceiling, and a reload would strand the run's lock instead of
      ending it.
      **Decided:** a 200 ms gate before it appears. Every preset clears it, so
      it behaves as "always" for real work; it exists so an until-idle jump on
      an empty floor doesn't flash a modal for a frame. The bar is determinate
      only above one chunk — a one-chunk jump would snap 0→100%.
      **Decided:** a jump stops the clock and waits out any beat in flight,
      rather than letting the two collide. They contend for the same server
      lock, and colliding would raise a 409 out of ordinary use — making 4.5's
      unlock button read as a workaround for our own bug.
      Verified over HTTP: an overlapping advance *and* an overlapping release
      both 409 with `Run 17 is already advancing`, which is why the overlay
      blocks releasing too.
- [x] 4.4 `RunMetricsStrip` — one row from `GET /:id/metrics`, the whole run on
      open and the jump's own ticks after a jump. Explicitly a placeholder for
      Track 5, not a dashboard.
      **Decided:** never fetched on the clock's beat. `/metrics` reads and
      aggregates every tick row, per-centre row and finished part in the
      window, which at 50000 ticks is a per-centre row per centre per tick.
      **Decided:** the window label comes from the *response*, so a strip left
      over from an earlier window says what it covers instead of misleading.
      Track 2's case is the reason: one centre read 10% utilization over a
      whole run and 52% over the ticks it was working.
      Names come off `/floor` — `/metrics` carries ids, and names are the one
      thing a run keeps no copy of.
      Exercised over HTTP: a jump's window (`?fromTick=601&toTick=1100`) came
      back `tickCount: 500`, mean WIP 3.12, peak 25, busiest centre 19.3% with
      a worst queue of 11.
- [x] 4.5 "Clear stale lock" on the 409. A tab closed or a server restarted
      mid-jump leaves `status = 'advancing'` with no process behind it, and
      every advance is a 409 for good after that, with curl the only cure.
      `ToastAction` is new — `showToast` takes a third argument and an action
      toast lives 12 s rather than 3.5 s.
      **Decided:** worded as clearing a *stale* lock, not as a retry. It is an
      assertion the user is making; if the run really is advancing elsewhere,
      clearing it lets two writers rewrite the same WIP rows.
      **Decided:** on the toast, not as a badge in the run picker — the picker
      reads `status` from a list fetched on mount, so it would show a stale
      lock more often than a real one.
- [x] 4.6 Doc sweep, folded into the units above rather than left to the end.
      Also corrected **two 3.4 leftovers** in `CLAUDE.md` found on the way: the
      chart pipeline still described `smoothThroughput` and a 120-tick cap, and
      the React-state notes still described the `*Ref` mirrors and the lazy
      `GET /api/routings/:id` that minted WIP parts with `crypto.randomUUID()`
      — all deleted with the frontend engine.
      The README's Phase 2 is rewritten: the speed control is recorded as
      **deliberately not built**, run-to-completion as delivered by Run until
      idle, and the unattended clock and calendar as still open.

## Track 4.5 — Dark redesign (`feat/dark-theme-shell`)

Decided 2026-09-03 after Track 4's browser pass: the page had grown past its
layout — everything competed for one scrolling column, and acting meant
scrolling. One track, because Tracks 5–7 all build UI on top of these
conventions (CLAUDE.md "Styling" holds them).

- [x] `feat/theme-tokens` — `@/` alias, shadcn/ui on zinc, semantic token
      layer in `index.css` (+ `running`/`starved`/`saturated` machine-state
      tokens), dark hard-set on `<html>`
- [x] `feat/app-shell` — `h-dvh` shell, sidebar with icons, pages own the
      viewport (regions scroll, pages don't)
- [x] `feat/ui-primitives` — shadcn table/dialog/select/tabs/etc. replace the
      hand-rolled primitives; ConfirmDialog wraps Dialog; toast stays ours
      (the "Clear stale lock" action depends on it)
- [x] `feat/list-pages` — the five list pages: PageHeader + "New …" dialog +
      internally-scrolling sticky-header table
- [x] `feat/simulator-layout` — control bars + Floor/Throughput/Metrics tabs;
      `WorkCenterTable` (stable name order, three-state badges) replaces the
      cards
- [x] `fix/release-race` — releasing waits out the clock's beat like a jump,
      and the picker lists only orders not yet released into the selected run
- [x] `docs/style-convention` — CLAUDE.md styling convention + this entry

## Track 5 — Run dashboard (`feat/run-dashboard`)

Re-planned on reach (2026-09-03). The entry said "the cumulative flatline bug,
then rate + WIP series" — the flatline half was already closed by 4.2
(`openingCents` landed before the jump controls, since one press reaches the
5000-row cap), so what remained was the series and the dashboard itself.
**Decided: frontend-only.** Everything comes from the three endpoints the page
already calls — `/metrics` (window aggregate), `/ticks` (per-tick money + WIP,
already fetched every beat), `/floor` (names, frozen capacities) — so there is
no per-centre *time series*, deferred until something needs it, and the
`runService` read-side split stays where this file put it: before Track 6.

- [x] 5.1 `throughputRate` — trailing rate in cents per simulated minute over
      a 60-tick window, the proper successor to the deleted `smoothThroughput`.
      Pure, tested, beside `cumulativeThroughput`.
      **Decided:** points earlier than the window into the series divide by
      the ticks actually covered, not the full window — past the `/ticks` cap
      the series is a suffix of the run, and the data before it isn't zero,
      it's absent; a full-window divisor draws a fake ramp at the left edge of
      every fast-forwarded chart. Unlike the cumulative curve a rate needs no
      opening balance: every point is local to its own window.
- [x] 5.2 Rate + WIP charts beside the cumulative curve. `TickSeriesChart`
      replaces `ThroughputChart` — one recharts wrapper, three instances of
      data plus formatters — and WIP is a step line, since parts don't move
      fractionally.
- [x] 5.3 `RunDashboard` replaces `RunMetricsStrip` in the Metrics tab: stat
      cards (window throughput, finished, cycle time, WIP) over a work-centre
      table with utilization bars.
      **Decided:** ranked by utilization descending — the constraint on top is
      the point, and ranking is safe because the pane redraws only when a
      window is asked for; stable name order stays a *floor* rule, where rows
      redraw every tick. The bar shifts to the `saturated` token at 90%.
      **Decided:** window controls (whole run, last 1000/5000, custom from–to)
      are the only new `/metrics` trigger — it stays off the clock's beat, the
      label still comes from the response, and a jump still re-windows onto
      its own ticks.
- [x] 5.4 Doc sweep: CLAUDE.md (dashboard paragraph, three-series chart
      pipeline, `throughputRate`'s left-edge rule), README (dashboard
      delivered, chart bullet), this file.
- [x] 5.5 Chart hints + honest tab names. Each chart sits in a titled card
      with an Info tooltip (shadcn tooltip, added via `npx shadcn add`)
      saying what the chart answers — the y-axis says what is plotted, the
      hint says why you'd look.
      **Decided:** the tabs rename to **Floor / Trends / Dashboard**, by view
      shape: "Throughput" stopped being honest once rate and WIP moved in,
      and "Metrics" overlapped it — throughput is itself a metric shown in
      both tabs.

## Track 6 — Operating expense & the P&L

Planned 2026-09-03. The user decided Track 6 delivers **all** of README Phase 4,
split into sub-tracks by dependency — 6A designed in detail, 6B–6E scoped here
and re-planned when reached, each its own branch/PR. **6A is what makes the
score able to go down and the agent's objective non-degenerate.**

**The time model (decided 2026-09-03):** ticks are **staffed seconds**; a
calendar day is `shifts × 28,800` ticks (8-hour shifts), frozen per run as
`simulation_runs.day_ticks` — 28,800 in 6A, one shift. All cost rates are
entered per true 24h calendar day and amortized over that day's staffed ticks,
so adding a shift (6D) amortizes the same rent over more productive seconds
while adding wages — the real economics. Overnight is not simulated and not
skipped-with-gaps; it simply isn't ticks, nothing moving off-shift. Rejected:
86,400-tick days (~3 wall-minutes and 4+ requests per simulated day, and the
seeded factory drains in under 1% of one, leaving rent a rounding error) and
redefining the tick (one tick = one simulated second is load-bearing).

**Rates live in both places:** the live factory carries them
(`work_centers.standing_cost_cents_per_day`; facility overhead + WIP carrying
bps in the `factory_settings` singleton), `POST /api/runs` may override the
facility-level pair, and the run freezes everything at creation — the same
invariant capacity follows. Forks (Track 7) and capital actions (6E) vary the
frozen copy.

### Track 6A — P&L core (`feat/operating-expense` + `…-ui`)

- [x] 6A.0 `refactor/run-service-reads` — read side of `runService.ts` split
      out (see the note at the top of this file). Own PR.
- [x] 6A.1 Ledger rewrite (this section) + schema + migration + seed retune.
      New: `factory_settings`; standing cost on `work_centers` and frozen on
      `run_work_centers`; frozen overhead/bps/`day_ticks`/`carry_remainder` on
      `simulation_runs`; `operating_expense_cents` + `carrying_cost_cents` on
      `run_ticks` (frozen cents — the P&L sums these, never re-derives from
      rates, so a rate edit can't rewrite a finished run). Seed: process times
      in minutes and a ~170-unit order book so a run spans days; rates sized
      so the factory profits only while the constraint is fed.
- [x] 6A.2 `simulation/operatingExpense.ts` + tests — `accrueRate` (exact
      integer floor-diff, a pure function of tick number, so batch splitting
      needs no cursor), `timeExpenseAtTick` (**accrued per rate, then summed**
      — floor diffs on a summed rate disagree with the summed breakdown
      mid-day), `rateWindowCents` (telescoped), `wipMaterialValueCents`
      (throws on missing records), `accrueCarrying` (remainder fold,
      `r ∈ [0, 10000·day_ticks)` — lifetime total is the exact floor of the
      ideal charge regardless of chunking).
- [x] 6A.3 `simulateBatch` wiring + tests — `RunState.costs` +
      `carryRemainder`, `TickRecord` expense fields, remainder carried out
      like `priorCounts`; carrying charges **end-of-tick** WIP (the set
      `wipCount` counts — a part finishing during the tick pays no rent for
      it). The one-batch-vs-several test re-run at nonzero rates.
- [x] 6A.4 Live-rate API — standing cost through work-centre POST/PATCH;
      `GET/PATCH /api/settings` over the id=1 upsert helper.
- [x] 6A.5 Freeze at create, accrue on advance — `createRun` copies rates
      (optional facility-level overrides in the POST body), `advanceRun`
      writes the tick expense columns and persists `carry_remainder`;
      `AdvanceResult` gains the two expense sums.
- [x] 6A.6 P&L reads — `RunSummary` gains OE/carrying sums, `netCents`
      (throughput − OE − carrying) and `dayTicks`; `RunMetrics` gains the
      windowed breakdown; `/floor` centres gain the frozen standing rate;
      `/ticks` rows gain the expense columns. Doc sweep.
- [x] 6A.7 UI: cost setup — standing-cost column on the work-centres table;
      `/setup/settings` Factory Settings page (overhead, carrying %/day);
      settings join `SetupDataProvider`'s load.
- [x] 6A.8 UI: pure transforms — `simTime.ts` (`ticksToDays`, `formatDays`),
      `standingCost.ts`, `netProfit.ts` (`netPerTick`, `openingNetCents` —
      the cumulative net curve has the same `/ticks`-suffix problem as the
      money curve, and its opening balance is **unfloored**: net before the
      window can legitimately be negative).
- [x] 6A.9 UI: net-profit curve **overlaid** on the cumulative-money chart
      (decided over a fourth card — the gap between the lines is the README's
      "running at a loss while output looks healthy"), dashed zero line; `Net`
      stat in the run bar.
- [x] 6A.10 UI: dashboard P&L — stat row led by net profit (destructive when
      negative), OE and carrying cards; per-centre "Standing cost" column
      derived client-side from the `/floor` frozen rate × observed ticks
      (display-only; deliberately not served — 6E invalidates the
      derivation); window label gains ≈ days. Doc sweep.

### Track 6B — Due dates and lateness (`feat/due-dates`) — re-plan when reached

Sales orders gain a due date in **calendar days** (`due day N` = tick
`N × day_ticks`); a unit finishing late books a penalty as frozen per-part
money on `run_finished_parts`, like every other credit. Lost sales deferred.

### Track 6C — Setup and scrap (`feat/setup-scrap`) — re-plan when reached

Setup cost charged when a work order's first unit reaches each step — the
batch-size trade-off without per-machine identity. Scrap as a per-step
probability drawn through the seeded RNG with a **domain separator** in the
draw key, so scrap noise never aliases process-time noise; scrapped units
record their spent material.

### Track 6D — Shifts and wages (`feat/shift-calendar`) — re-plan when reached

`day_ticks = shifts × 28,800` per run; wages accrue per staffed tick per
operator, overtime at a multiplier when authorized; machines stop off-shift
(off-shift time is not simulated). Rent stays per calendar day.

### Track 6E — Capital actions (`feat/capital-actions`) — re-plan when reached

Actions that cost money and mutate the run's **own frozen config**: buy/retire
a machine, hire/fire an operator, authorize overtime. Operators gate effective
capacity = `min(machines, operators)` — a new frozen per-centre column.
Mid-run rate changes mean per-centre expense must then be stored per tick or
effective-dated (`accrueRate` generalizes to `floor((t−t₀)·r/D)` diffs) — the
reason 6A never serves a derived per-centre cost.

## Track 7 onward — re-plan when reached

- [ ] Track 7 `feat/run-forking` — fork at a checkpoint, compare on net profit.
      Depends on the seeded RNG from 1.2.
- [ ] Track 8 `feat/agent` — tool layer: create, advance, fork, read metrics,
      compare.

## Fixed latent bug

Shortening a routing's step list stranded in-flight parts with
`stepIndex >= steps.length`, and the frontend's `simulationTick.ts` indexed
`steps[stepIndex]` at four sites with no guard, with `strict` off — a live
crash reachable through the routing editor. Closed for good in 3.4: the backend
engine finishes such a part at the current tick (1.2), `deriveFloorView` puts it
on no machine (3.4a), the routing edit no longer reaches a released part at all
(3.1b), and the frontend engine that carried the bug is deleted (3.4).
