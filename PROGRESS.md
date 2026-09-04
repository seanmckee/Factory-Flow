# Build progress

Operational ledger for the road to the AI agent. The README holds the narrative
ten-phase arc; this file answers "what do I do next" in one screen.

**One unit = one commit = one review checkpoint.** Tick a box in the same commit
that completes it.

---

**You are here:** **Track 6E (capital actions) is built** — planned and built
2026-09-04, units 6E.1–6E.6 below, **one thing outstanding: nobody has driven
the UI in a browser** (the extension was not connected; see 6E.5). It is the
first thing in the project that
changes a run's **own frozen config** while the run is alive: buy or retire a
machine, hire or fire an operator, each a lump capital spend frozen on an
append-only action row and subtracted from `netCents` as the fifth P&L line.
Operators became explicit, so a centre runs `min(machines, operators)` and a
machine nobody staffs is rent with no output. Before it, 6D (shifts and
wages), 6C (setup as constraint time, scrap in its
own RNG domain), 6B (due dates + on-time delivery) and 6A (the P&L core).

**Deferred out of 6E to 6F** (user call while planning): overtime and mid-run
shift changes. Both make a run's calendar day non-uniform, which is the one
place `day_ticks` is a single frozen integer, and overtime without a wage
premium strictly dominates every other labour lever. See the 6F section.

**6H.1 landed out of order (2026-09-04, user call): the playground seed.** Ten
work centres, ten parts with full routings, 29 orders / 3,600 units across due
days 2–18 — deep enough to drive long runs with nothing entered by hand, and
the first book with a horizon a machine can pay back over. Verified by a full
playthrough: expanded early it nets **+$42,444 at 100% OTD**, the drill press
reads 82.7% *with two presses*, and one idle day costs $4,051. See 6H.1 below.

**Next up: 6G, then the rest of 6H, and both before Track 7** — added
2026-09-04 after driving 6E, and they are prerequisites rather than polish.
**6G (simulator throughput):** an *empty* floor costs 8.2 s per 20,000 ticks
because 140,000 observation rows go to the database whatever happens, so
per-minute buckets are finally worth the schema change; the O(WIP) tick loop is
a second, independent curve that bites past ~500 parts. 6H.1 made both bite for
real — a 15-day playthrough is ~5 wall-minutes and ~5M observation rows, and
WIP peaked at 865 parts. **6H.2/6H.3 (legible constraint, rolling demand):**
buying capacity is now a decision worth making, but the dialog still shows no
utilization, so *where* to buy is guesswork.

Then **Track 7 (forking)**, whose comparison is what all of Track 6 exists to
make meaningful — and which 6E just gave its sharpest question: fork at a
checkpoint, buy the second drill press in one branch only, and read the payback
off the two net curves. That question needs 6H to have an answer at all.
Track 6F (overtime, shift calendar) is scoped below and waits behind all of it:
forking is load-bearing for the agent, overtime is one more lever.
A hands-on pass over 6E's UI is owed before any of them.

**Why Track 6 was worth it, in one line each.** Track 6A made the score able
to go down,
which is what makes an agent's objective non-degenerate; 6B adds the promise
the agent can break without buying anything with it; 6C makes batch size a
real decision and output itself unreliable; 6D prices the staffed hour; 6E is
the first decision that costs money up front and changes the factory
afterwards — which is what a fork is *for*.

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
- [x] 6A.10e Durations read in hours past two staffed hours —
      `formatDurationSeconds` in `simTime.ts` (graded s → m → h), so the
      cycle-time card says "2.7h / 5.0h" rather than "163.6m"; null stays a
      dash, zero stays a printed duration.
- [x] 6A.10d One Trends chart, hideable lines, Day·time axis, smooth rate
      (user call after driving 6A.10c: three cards hid the relationships, the
      minute-bucket rate drew a comb, and a tick axis "means nothing to a
      user"). **Decided:** the tab is one `TrendsChart` — money left axis,
      WIP right, legend click hides a line (never the last one), x-axis and
      tooltip in Day · time via `formatTickShort`/`formatTickTime`.
      **Decided:** the rate becomes `trailingRate` in cents per staffed hour
      over a 3600-tick window — finishes are point events minutes apart, so a
      minute-scale window is a comb (noise, not rate); the window counts
      samples but divides by ticks, so raw and bucketed series agree, and the
      left edge still divides by covered ticks. `TickSeriesChart`,
      `throughputRate` and `bucketThroughputRate` deleted with their tests —
      superseded, and dead wrappers are the drift the working agreement bans.
- [x] 6A.10c Whole-run charts + drain-stop (after the second hands-on: a +1
      day jump on a raised-capacity run drained the floor at staffed hour ~5,
      the newest-5000 window showed only the dead time after it — rate and WIP
      flat zero — and Trends dragged rendering 3×5000 recharts points).
      **Decided:** `/ticks` gains `?bucket=N` — money summed per bucket (the
      opening-balance identity stays exact; verified bucket sums equal run
      totals to the cent), WIP read at bucket end, grid aligned to absolute
      ticks, bucket inlined into the SQL because GROUP BY and ORDER BY must be
      the same expression and two binds are two expressions. The chart asks at
      `chartBucket` resolution (seconds ≤ 5000 ticks → minutes → hours), so
      Trends draws the whole run (a day = 480 points) and the cap becomes
      practically unreachable. Rate over a bucketed series is
      `bucketThroughputRate` — rescale, not slide. **Decided:** a jump stops
      itself when the floor empties (toast names the Day · time) and refuses
      an already-empty floor: the jump holds the lock, so nothing can land
      mid-jump and every tick past a drain is rent nobody chose. Not brought
      back: Run until idle — the drain-stop is its useful half.
- [x] 6A.10b Advance throughput + streaming jumps (after the first day-scale
      hands-on: a simulated day took ~22s behind a blocking modal). Measured:
      the pure simulation of a day is 0.25s (~116k ticks/s) — the rest was
      ~211k rows/day of Neon round trips in flat 1,000-row chunks.
      **Decided:** insert chunks sized per table against the ~65,535
      bind-parameter cap (`chunkFor(paramsPerRow)`), `TICKS_PER_BATCH`
      500 → 3600 (one staffed hour; 7,200 tried, bought ~0.8s at double the
      lock hold). A day is ~8s and falling out of the modal: **jumps stream**
      — inline progress in the transport bar, the page refreshes per committed
      hour, `SimulatingOverlay` deleted. **Run until idle removed** (user
      call): with rent accruing against time an idle factory is a money
      furnace, so an empty floor is not a goal; `AdvanceResult.wipCount` stays,
      as an agent's stop condition. Next lever if ~8s ever matters:
      per-minute observation buckets (60× fewer rows) — a schema change,
      deliberately not taken now.
- [x] 6A.10a UI: transport catches up with the day scale (added after the
      first hands-on: minute-scale process times made the 1× clock unwatchable
      and +100/+500/+1000 ticks meaningless). **Decided:** the live clock plays
      one simulated **minute** per real second — 60 ticks a beat, one small
      request, nowhere near the ~500 ticks/sec that made Track 4 reject a
      multiplier, and it restores exactly the pace the old seconds-scale seed
      had at 1×. Presets become **+1 hour / +4 hours / +1 day**, and the run
      bar gains a calendar readout (`formatTickTime`: "Day 2 · 3:41:05" —
      staffed time, the only time a run simulates).
- [x] 6A.10 UI: dashboard P&L — stat row led by net profit (destructive when
      negative), OE and carrying cards; per-centre "Standing cost" column
      derived client-side from the `/floor` frozen rate × observed ticks
      (display-only; deliberately not served — 6E invalidates the
      derivation); window label gains ≈ days. Doc sweep.

### Track 6B — Due dates and on-time delivery (`feat/due-dates`)

Planned 2026-09-04. Sales orders gain a due date in **calendar days**: `due day
N` means "by the end of staffed day N", so on time ⇔
`completedAtTick <= dueDay × day_ticks` — the due tick itself is on time.
Days rather than ticks, converted against the run's own frozen `day_ticks` at
the load boundary (`loadRunState`), so a two-shift run (6D) reads the same
promise as more staffed seconds; the promise is relative to the run's own
clock, there being no calendar epoch. **Decided: no money penalty** — the
original stub booked lateness as frozen per-part money, but the user cut that:
lateness feeds an **OTD metric** only and `netCents` is unchanged. A penalty
can be layered later precisely because the due tick is frozen per part —
`run_finished_parts.due_at_tick`, frozen at credit time exactly as
`unit_price_cents` is, is any future penalty's basis. Note the null semantics
diverge from price: `due_at_tick` is null for an uncovered unit *or* a covered
unit whose order had no due date, so it is **not** "null exactly when
`sales_order_id` is" — and `sales_order_id`'s ON DELETE SET NULL nulls the
reference while the due tick stays frozen, which is why the metric reads only
`due_at_tick` (a deleted order's units drop out of the per-order table but
stay in the overall aggregate). Sales orders stay read-live-per-advance, so a
due-day edit lands between advances and touches only units not yet finished —
the same caveat as price, kept deliberately. Lost sales deferred; no PATCH
route for sales orders (creation-only stays the convention).

- [x] 6B.1 Schema + migration + seed + this ledger rewrite. Nullable
      `sales_orders.due_day`; nullable frozen `run_finished_parts.due_at_tick`
      (no default, no backfill — pre-6B rows read "not measured", the right
      retroactive semantics). Seed: SO-2001 due day 1 (makeable only if
      brackets release immediately and run first), SO-2002 day 2 (comfortable
      brackets-first, late flanges-first — the due date agrees with the price
      signal), SO-2003 day 3 (on time iff the drill press never starves, in
      tension with carrying cost rewarding a late WO-1002 release).
- [x] 6B.2 Engine + tests. Structural `SalesOrder` gains `dueAtTick:
      number | null` (required-nullable — optional would leak `| undefined`
      through every credit under `exactOptionalPropertyTypes`); the credit and
      `FinishedPartRecord` carry it through; `aggregateOnTimeDelivery` in
      `metrics.ts` (empty/unmeasured → nulls like cycle time — "no promises"
      is not "100%"; lateness stats over late units only, null when none; no
      throws — due-before-release is legal, an order can already be late at
      release). Windowing stays the caller's job, on `completedAtTick`.
- [x] 6B.3 API. `dueDay` nullish in the create schema and POST; `loadRunState`
      converts day → tick (the one place); `runService` writes the frozen
      column (`chunkFor(10)`); `RunMetrics` gains `onTimeDelivery` over the
      same windowed finished rows as cycle time. `RunSummary` deliberately
      unchanged — whole-run `/metrics` already answers it, and a summary copy
      would be a second code path for the same number.
- [x] 6B.4 UI + doc sweep. Due-day field in the create dialog and a Due column
      on the sales-orders table; OTD stat card on the dashboard (— when
      nothing measured, late count + worst lateness in the detail; destructive
      styling stays reserved for money).
- [x] 6B.5 Per-sales-order delivery breakdown — an aggregate 78% can't say
      which promise broke. `groupDeliveryBySalesOrder` reuses
      `aggregateOnTimeDelivery` per order so the rows and the card agree by
      construction; `RunMetrics` gains `salesOrderDelivery`; the dashboard
      gains a Deliveries table (order number and quantity joined client-side
      from live sales orders, like work-centre names off `/floor`).

### Track 6C — Setup and scrap (`feat/setup-scrap`)

Planned 2026-09-04. Two ways a unit stops being worth its routing: the
changeover before the first one, and the draw that ruins one on the machine.

**Setup is machine time, not a money charge.**
`routing_steps.setup_time_seconds` has existed end to end — schema, zod,
routes, the step editor — since the first migration, with the engine the only
thing ignoring it; 6C makes that column real rather than inventing a parallel
cents column. One changeover per **(work order, step)**: machines within a
centre are anonymous (the stub's "without per-machine identity"), so the first
unit of a work order **admitted to a machine** at a step pays the pinned setup
time, folded into its `actualProcessTimeSeconds`, and every later unit of that
work order processes clean. Admission-pays rather than arrival-pays, because
units of one work order can *arrive* at a step out of unit-index order while
admission follows list order — arrival-pays could hang the setup on a unit
another unit then beats to the machine. The payer is deterministic because
list order is: in-memory order is preserved tick to tick, and a reload orders
by `run_wip_parts.id`, which is insert order. **No RNG on setup:** process
variance is the variance that drives starve/block, and a noisy setup buys
nothing but a second domain separator to maintain. Setup's cost surfaces the
way all time does — rent and standing cost accrue per tick, and a changeover
at the drill press eats constraint minutes — so the batch-size trade-off
(README Phase 4's "finally makes batch-size decisions have a real trade-off")
arrives with **no new money category**; `busy` counts a machine in setup as
busy, which is what utilization means. A consequence worth naming: SO-2001
spanning two work orders now costs the drill press a second changeover — an
allocation split is not free anymore.

**The setup-paid state is persisted, not derived** — nullable
`run_work_order_steps.setup_started_at_tick`, null meaning not yet. Whether
(work order, step) has been set up must survive a batch boundary or the
one-batch-vs-several invariant breaks, and deriving it means consulting WIP,
finished *and* scrapped rows together (the paying unit may have scrapped out
of the very step it set up); a nullable tick on the pinned step row is one
column in a read that already happens. Mutable state beside frozen config has
precedent — `tick_num` and `carry_remainder` sit on `simulation_runs` beside
the frozen rates — and it is written at most steps-per-route ×
released-orders times over a run's whole life. `RunState` carries the set in,
`RunBatch` carries it out advanced (like `priorCounts`) plus the batch's
newly-started setups for the write.

**Scrap is a per-step probability in basis points** —
`routing_steps.scrap_bps`, integer like the carrying rate, default 0, pinned
into `run_work_order_steps` like everything else a run reads — drawn **at
step completion**: the machine time was spent and `busy` counted it, then the
unit fails and leaves the floor that tick. The draw goes through the seeded
RNG with a **domain separator**: process-time keys stay byte-identical
(`seed:wo:unit:step`, so a pre-6C run still re-creates exactly) and scrap
draws in a `scrap`-marked domain that cannot collide with the all-numeric
process keys. Keyed RNG has no stream to shift — the separator exists because
without it a unit's scrap fate would be the *same uniform* as its process
time, and "slow units always scrap" is aliasing, not noise. A part stranded
past a shortened routing draws no scrap — it did no work, matching the
holds-no-machine rule (and post-3.1b stranding is unreachable anyway).

**A scrapped unit is its own record, not a finished part** — new table
`run_scrapped_parts`, append-only, freezing `material_cost_cents` at scrap
time ("scrapped units record their spent material"). Not a flag on
`run_finished_parts`: every reader of that table — the `priorCounts`
`GROUP BY` that *is* the allocation cursor, cycle time, OTD, the per-order
deliveries, the finished counts, the summary's throughput sum — depends on
"finished = credited", and a flag would put a load-bearing `WHERE` in all of
them. **Scrap consumes no coverage:** the credit cursor counts credited units
only, so the next good unit takes the scrapped one's sale and a short work
order under-delivers — which is where scrap's money bite lands, alongside the
constraint time and rent already spent on the ruined unit.

**Decided: no material write-off in 6C** — `netCents` is unchanged, the 6B
rule again. An *uncovered* finished unit's spent material is already
recorded-not-charged (it is inventory, not a loss booked at finish), and the
model has never expensed material purchase anywhere; a scrap-only write-off
would bolt a fourth money category on before the incentive needs it. Scrap
already moves the score through lost sales, wasted constraint time and
carrying paid en route. The write-off stays layerable later precisely because
the material cents are frozen per scrapped unit — the same argument that made
6B's due tick a penalty basis without a penalty.

- [x] 6C.1 Schema + migration + seed retune + this ledger rewrite.
      `routing_steps.scrap_bps` (default 0); `run_work_order_steps` gains
      `setup_time_seconds` + `scrap_bps` (the pin — the run reads only its own
      config; both default 0, so pre-6C releases read "no changeover, no
      scrap", the same retroactive semantics as 6B's null `due_at_tick`) and
      nullable `setup_started_at_tick`; new `run_scrapped_parts`
      (run CASCADE, `part_uuid`, work order RESTRICT, `unit_index`,
      `released_at_tick`, `scrapped_at_tick`, `sequence`, un-keyed
      `work_center_id` frozen at scrap time, frozen `material_cost_cents`;
      `UNIQUE(run_id, part_uuid)`, indexed
      `(run_id, scrapped_at_tick, id)` like the finished table).
      **Sized smaller than the plan's first guess** once the queue order was
      walked: drill setup 600s, cutter/deburr 300s, because SO-2001's last two
      units come from WO-1003, which queues behind *all* of WO-1001 including
      its overage — at 15 minutes the split's second changeover blew the day.
      As landed, brackets-first puts SO-2001's last unit at ~tick 28,100 of
      28,800 — a ~1σ margin, a tight promise rather than the old few-sigma
      one, which is the honest shape of a due date once changeovers exist.
      Scrap 50/100/50 bps at cutter/drill/deburr (~2% per bracket, ~1.5% per
      flange); WO-1001 52 units against its 50-unit allocation (overage, the
      planned answer to scrap) while WO-1002's exact 90 leaves SO-2003 exposed
      — both halves of the overage decision on the board. Arithmetic only so
      far: the engine reads neither column until 6C.2/6C.3, so the live
      verification of the due-day stories lands there.
- [x] 6C.2 Engine: setup + tests. `RoutingStep` gains `setupTimeSeconds`
      (required, not optional — the 6B `exactOptionalPropertyTypes` rule);
      the admission pass charges the first fresh unit per (work order, step)
      — every pass-two admit is fresh, since progress resets on transition and
      a mid-process part holds its machine through pass one — and reports the
      setups it started; `RunState` gains the setup-done set,
      `RunBatch` the advanced set plus the batch's new setups. Tests: first
      admitted unit pays and the second doesn't; two work orders on one
      routing each pay their own; capacity 2 admitting two fresh units of one
      work order in one tick charges exactly one; a transition draws clean and
      the setup lands at the next admission; the
      one-batch-vs-several test re-run with nonzero setup times, carrying
      `setupDone` between chunks. **Two rules settled here:** a part already
      mid-process never pays (so a pre-6C run reloading mid-step is never
      retro-charged), and a zero setup time is never *recorded* as a
      changeover — recording it would write a row per (work order, step) for
      steps that need none. `loadRunState` and the floor read the new columns
      already (the engine type requires them); the release pin and the
      `setup_started_at_tick` write-back are 6C.4, which is safe to stage
      because until release pins them every stored setup time is 0 and the
      engine provably no-ops.
- [x] 6C.3 Engine: scrap + tests. `unitDraw` gains a `DrawDomain` — the
      process domain is the unmarked legacy key, asserted byte-identical
      against a value pinned before domains existed, so a pre-6C run still
      re-creates exactly; scrap draws under a `scrap:` mark that cannot
      collide, the process key's second field being always numeric.
      `RoutingStep.scrapBps` required; the quality gate sits at step
      completion, after the progress check and before anything moves, so the
      machine time is spent and `busy` counted it; a failed unit exits as a
      `ScrappedPartRecord` (material frozen off the `costByWorkOrder` map the
      batch already builds) instead of reaching `creditFinishedParts` — the
      allocation cursor never sees it, and a test rigs the rate between two
      units' own draws to pin the next good unit taking the scrapped unit's
      sales order. `aggregateScrap` in `metrics.ts`
      (count + material cents; windowed by the caller on `scrappedAtTick`;
      empty window → zeroes, since zero scrap is a real observation, unlike
      cycle time's nulls). Scrap at the last step scraps, never credits; a
      50%-per-step route chunked four ways scraps identical units to one
      batch of 40.
- [x] 6C.4 API. `scrapBps` through the step schemas (capped at 10000,
      **defaulted to 0** so step payloads predating 6C stay valid — which
      leaves one known hazard until 6C.5: the routing editor round-trips steps
      without the field, so saving a routing in the UI resets its scrap rates),
      POST/PUT and GETs; release pins both new columns; `advanceRun` inserts
      scrap rows, updates the batch's `setup_started_at_tick`s in the same
      transaction, and carries `setupDone` between batches like the counts;
      `RunMetrics` gains `scrap` windowed on `scrapped_at_tick`;
      `AdvanceResult` gains `scrappedCount` (an agent-visible signal, cheap —
      the batch already holds the rows). `RunSummary` deliberately unchanged,
      as with OTD: whole-run `/metrics` answers it.
      **Exercised over HTTP, and the 6C.1 due-day arithmetic verified live:**
      brackets-first, SO-2001's 52nd unit landed at tick 27,067 of 28,800 with
      one bracket scrapped *at the drill press* mid-day — the overage absorbed
      it and the order still shipped 52 on time; the written setup ticks tell
      the queue story (WO-1001 pays the drill changeover at tick 560, WO-1003
      at 25,112 behind all of WO-1001, the flanges' still unpaid at day's
      end); two runs from seed 4242 advanced as 20000+8800 and as 4×7200
      produced identical money, scrap and completion ticks, which is the
      setup-carry and scrap determinism proven at the service layer;
      `scrapBps: 20000` 400s with the field's own message.
- [x] 6C.5 UI + doc sweep. Step editor gains a scrap field — entered as a
      percentage, sent as bps, the carrying-rate convention (the setup-time
      field already exists), finest step 0.01% because bps are integers, and
      the round-trip closes the 6C.4 hazard: `toDrafts` reads bps back as the
      percentage the user typed, so saving a routing no longer resets its
      rates; `routingSteps.ts` drafts/parse stay the pure
      tested layer; dashboard gains a Scrap stat card (count, material cents
      in the detail line; neutral styling — destructive stays reserved for
      money that is *in* `netCents`). CLAUDE.md engine/cost-model sections,
      README Phase 4 bullets, this file — plus two stale CLAUDE.md figures
      found on the way (`TICKS_PER_BATCH` still said 500 and
      `ROWS_PER_INSERT` still existed; both superseded in 6A.10b).

### Track 6D — Shifts and wages (`feat/shift-calendar`)

Planned 2026-09-04. The calendar day gets a width and the people get paid:
a run's day is `shifts × 28,800` staffed ticks, and every staffed tick costs
wages whether or not anything moves.

**Shifts are a facility setting frozen per run.** `factory_settings.shifts`
(1–3, default 1), and `createRun` freezes `day_ticks = shifts × 28,800` — the
column 6A reserved for exactly this, so nothing downstream changes shape:
rent amortizes thinner over a longer day (`accrueRate` is already a function
of `day_ticks`), due days convert against the run's own day in `loadRunState`
(the reason 6B chose calendar days), and the clock reads staffed time as it
always has. Off-shift time still isn't ticks. `shifts` joins the POST
`/api/runs` overrides — one-shift vs two-shift is precisely the comparison a
Track 7 fork wants to run.

**Wages are a per-staffed-hour rate — the third cost class.**
`work_centers.wage_cents_per_hour`, per operator, frozen into
`run_work_centers` like capacity and standing cost. **Operators = capacity
until 6E** (the explicit `operators` column and `min(machines, operators)`
gating are 6E's lever, recorded there), so a centre's wage bill is
`capacity × rate`, accrued with the same exact floor-diff as every time rate
but over **D = 3,600** — per rate then summed, as always. That denominator is
the entire economics: rent is per calendar day, so a second shift amortizes
it; wages are per staffed hour, so a second shift doubles the day's bill.

**Wages are their own frozen tick column, and the score subtracts them.**
`run_ticks.wage_cents` beside expense and carrying;
`netCents = throughput − OE − carrying − wages`. Deliberately *not* folded
into `operating_expense_cents`: the wages-vs-rent split is exactly what a
shift decision is about, and one merged column would make a one-shift and a
two-shift fork read as the same P&L shape with different slopes and no
explanation.

**Overtime is deferred to 6E, deliberately.** Overtime is an *authorization*
— a mid-run action against the run's own frozen config, which is 6E's whole
territory; a run that authorizes overtime at creation is just a longer day
with a premium, i.e. shifts again. The machinery 6E already owes (effective-
dated rates, `accrueRate` generalized to `floor((t−t₀)·r/D)` diffs) is the
same machinery overtime needs.

**A known non-tension, recorded rather than hidden:** against a finite seeded
order book, two shifts near-dominate one — the book needs the same staffed
hours (same total wages), fewer calendar days (less rent), earlier
deliveries. The counterweights are 6E's (hiring the second shift's operators
costs money; overtime as the cheaper marginal hour) and eventually rolling
demand. 6D's job is to make the lever exist and price it honestly, not to
balance it yet.

- [x] 6D.1 Ledger rewrite (this section) + schema + migration + seed.
      `factory_settings.shifts` (default 1);
      `work_centers.wage_cents_per_hour` (default 0), frozen copy on
      `run_work_centers`; `run_ticks.wage_cents` (default 0 — pre-6D ticks
      read "no wages", the usual retroactive rule). Seed: wages with a skill
      spread (drill highest), and prices raised so the factory stays
      profitable **when the constraint is fed** now that people are paid —
      target roughly: bracket margins strongly positive per drill-day, flange
      margin *below* the staffed-day cost line but above zero, so flanges are
      worth running once staffed yet can't carry the factory — the
      contribution-margin lesson beside the constraint one. Verify the
      arithmetic in seed comments, live at 6D.3.
- [x] 6D.2 Engine: wages + tests. `CostRates` gains per-centre
      `wageCentsPerHour` (the loader pre-multiplies by frozen capacity, so
      the engine sums rates without knowing about operators);
      `wagesAtTick(rates, tickNum)` accrues each centre's rate over 3,600 and
      sums — per rate then summed, mid-hour split-vs-whole tests like
      `timeExpenseAtTick`'s; `TickRecord.wageCents`; batch wiring; the
      one-batch-vs-several test re-run with wages on.
- [x] 6D.3 API. `shifts` through settings GET/PATCH; `wageCentsPerHour`
      through work-centre POST/PATCH; `createRun` freezes
      `day_ticks = shifts × 28,800` (override in the POST body) and the wage
      rates; `advanceRun` writes the tick column; `AdvanceResult`,
      `RunSummary`, `RunMetrics` and `/ticks` rows gain `wageCents`, with
      `netCents` subtracting it everywhere it is computed; `/floor` centres
      gain the frozen wage rate (the standing-cost pattern — display-only
      derivations stay client-side). Exercise over HTTP: a two-shift run's
      day-1 due tick is 57,600; a staffed hour sums to exactly
      `Σ capacity × rate`; the P&L identity across summary, metrics and tick
      sums. All verified live: one staffed hour of a two-shift run accrued
      exactly 6,800c of wages (Σ capacity × rate) beside 8,436c of rent — the
      same rates that accrue ~16,875c/hour at one shift, the amortization
      visible in one number; SO-2001's due tick froze at 57,600; a
      `shifts: 1` override under two-shift settings froze 28,800.
- [x] 6D.4 UI + doc sweep. Factory Settings gains Shifts; work-centres table
      gains a Wage column; dashboard gains a Wages card and the net stat
      subtracts it (server-side already — but `netPerTick`/`netCentsOf` in
      `netProfit.ts` must learn the fourth column or the Trends net curve
      contradicts the run bar); `TickSample` mirror gains `wageCents`.
      CLAUDE.md cost-model section (three costs become four), README Phase 4
      wages bullet, this file.

### Track 6E — Capital actions (`feat/capital-actions`)

Planned 2026-09-04. Four actions — buy a machine, retire a machine, hire an
operator, fire an operator — and with them the first mutation of a run's
**own frozen config** while it is alive. Everything until now froze at
creation and stayed frozen; 6E keeps the invariant (a run still reads only its
own copies, never `work_centers` or `factory_settings`) and adds the one way
those copies can change.

**Capital spend is a lump at the moment of purchase, and the fifth P&L line.**
This closes a README open question, and the decisive argument is the
timescale: a realistically amortized machine — $20k over a five-year life is
$11/day against a ~$1,900/day factory — is *free* inside the days a run spans,
so "always buy" becomes the right answer to every question, which is the
degenerate objective 6A existed to kill. Amortization only bites here by
inventing an unrealistically short machine life. Lump also keeps payback
readable, which is the point of the feature: the cumulative net curve steps
down by the purchase and the extra output has to climb back out, so payback is
where the curve recrosses what doing nothing would have earned. And it is the
**reversible** call — the cents are frozen on the action row, so amortization
stays layerable off that column later, exactly as 6B froze a due tick and
charged no penalty and 6C froze scrapped material and booked no write-off.
**No cash balance:** a run cannot be refused a purchase for want of funds and
cannot go bankrupt — net simply goes further negative. A spend limit needs a
cash model, which is a bigger idea than this track.

**Standing cost is reinterpreted as per machine.**
`work_centers.standing_cost_cents_per_day` becomes what *one* machine costs to
keep, so a centre's rent is `machines × rate`: buying charges the second
machine's rent automatically and retiring hands it back. A documentation
change with no data change today — every seeded centre has one machine.
Rejected: per-centre with the buy action naming the standing cost it adds (the
caller, eventually the agent, has to invent a number the factory already
knows), and per-centre unchanged by purchases (a machine that costs nothing to
keep makes buying it a free decision).

**Operators become explicit, and effective capacity is
`min(machines, operators)`.** The loader computes the min, so the engine stays
as ignorant of operators as it already is for wages — the 6D pre-multiply
pattern. The wage bill becomes `operators × rate` rather than
`capacity × rate`, which is what makes hiring a lever rather than a
consequence, and paying an operator with no machine to run (or owning a
machine with nobody on it) is a mistake the model will now let you make and
charge you for. `work_centers.capacity` keeps its name and now means
**machines**; renaming it was rejected as wide churn through the API mirrors
and routing pickers for no behavioural gain.

**Rates become effective-dated, and this is the architectural core.**
`accrueRate` is a pure function of the tick number — the property that makes
batch splitting cursor-free, the same property the RNG has — and it assumes a
rate constant for the run's whole life. A purchase changes a centre's standing
rate; a hire changes its wage rate. So each rate carries the tick it took
effect and accrues `floor((t−t₀)·r/D) − floor((t−1−t₀)·r/D)`. **Per rate, not
per centre and not per run:** only the rate that actually changed re-phases,
so hiring at the drill press never perturbs the cutter's rent accrual, and
every segment accrues exactly the floor of its own duration × rate. Because
an action takes the run lock like a release or an advance, **a batch can never
span a change** — the engine still sees one rate per batch, and the
one-batch-vs-several determinism test stands untouched.

**The action log is append-only with frozen money.** `run_capital_actions` is
the `run_finished_parts` / `run_scrapped_parts` pattern again: the cents are
frozen at the tick the action was applied, so editing a price later cannot
rewrite what a run paid. Salvage is a **negative spend**, so the P&L line is
one sum over one column. The row also records the machines and operators
*after* the action, so the log reads without replaying deltas.

**Prices are master data, frozen at creation** — per-centre machine purchase
and salvage, and a per-centre operator hiring fee (the seed's wages already
carry a skill spread, so hiring a driller costing more than a packer is the
consistent shape). The run charges its own frozen copies, the invariant 3.1b
established. **Firing is free**, deliberately: a crew you can shed cheaply is
the temp lever, and it is what makes a second shift's commitment — and, at
6F, overtime's premium — a real comparison rather than a formality.
**Retiring the last machine is allowed:** a centre with no machines starves
everything routed through it, which is a legitimately terrible decision and
not the model's business to forbid.

**The utilization denominator moves into the observation.** Utilization is
busy machine-ticks ÷ (capacity × observed ticks), and capacity has been safe
to read live only because it never moved. It moves now, so
`run_tick_work_centers` gains a nullable `capacity` written per tick — the
**effective** capacity the tick actually gated admission on — and
`aggregateMetrics` divides by summed capacity-ticks. Null means pre-6E, read
the run's frozen capacity, the same retroactive rule as 6B's `due_at_tick` and
6C's pinned zeroes. Without it a window spanning a purchase divides the days
*before* the purchase by the new machine count and reports the constraint half
as busy, in precisely the window someone opens to judge whether the purchase
helped. Rejected: reconstructing the capacity timeline from the action log at
read time — exact, but it makes utilization depend on two tables agreeing, and
Track 2.1's rule is that observations are emitted, never reconstructed
afterwards.

- [x] 6E.1 Ledger rewrite (this section) + schema + migration + seed.
      Live: `work_centers.operators`, `machine_purchase_cents`,
      `machine_salvage_cents`, `operator_hire_cents`; standing cost
      reinterpreted per machine (comment only). Frozen: the same four on
      `run_work_centers`, plus `standing_cost_effective_from_tick` and
      `wage_effective_from_tick`. New `run_capital_actions`.
      `run_tick_work_centers.capacity` nullable with **no backfill**.
      `operators` is **backfilled to `capacity`** rather than defaulted to 1,
      on both the live and the frozen table: a capacity-2 centre has to keep
      behaving exactly as it did, since operators = capacity was 6D's stated
      assumption, not an accident. Seed prices follow one explainable rule —
      purchase = four days of that machine's standing cost, salvage = half of
      purchase (so churning a machine costs half its value and the model
      punishes indecision), hire = two staffed days of that operator's wage.
      Sized so the second drill press pays back **only if bought early**: one
      press runs the ~170-unit book in ~2.9 drill-days and two in ~1.5 (the
      cutter binds next at 120 brackets/day), so the whole prize is the ~$1,900
      of daily cost that compression avoids, against a $1,200 press. Buying on
      day 2, with the book nearly chewed, is a clear loss — and a book that
      ends is itself the lesson, capacity beyond the market being the thing
      Goldratt says is not throughput.
      **The backfill is hand-added to the generated migration**, two `UPDATE`s
      setting `operators = capacity` on the live and the frozen table: the
      column default of 1 would silently halve a two-machine centre's wage
      bill and its effective capacity, inside runs already created, and
      operators = capacity was 6D's *stated* assumption rather than an
      accident. Migration applied and reseeded; arithmetic only so far — the
      engine reads none of the new columns until 6E.2/6E.3, so the payback
      story above is verified live at 6E.4 the way 6C.1's due-day story was.
- [x] 6E.2 Engine: effective-dated accrual + tests. `accrueRate` gains a
      `sinceTick`; `CostRates`' per-centre standing and wage entries become a
      `DatedRate` — cents plus the tick it took effect;
      `timeExpenseAtTick` and `wagesAtTick`
      keep their shape (per rate, then summed). Tests: a closed segment
      accrues exactly `floor(ticks·r/D)`; a change re-phases only its own rate
      and leaves every other centre's stream byte-identical; a pre-6E run
      (every `sinceTick` zero) accrues exactly what it accrued before, the
      6C domain-separator precedent.
      **Decided during the unit:** a rate charges **nothing at or before its
      own epoch** rather than throwing. It is reachable arithmetic — an action
      applied at tick 40 leaves tick 40 to the old rate — and the naive floor
      diff would charge a spurious cent there, `Math.floor` rounding a
      negative share away from zero. The epoch is the tick the action was
      applied *at*, so the first tick at the new rate is the next one, which
      makes `sinceTick: 0` mean "since the run began" and the default path
      identical to the old one-argument function.
      **`rateWindowCents` is deleted**, with its three tests — the telescoped
      O(1) window 6A.2 built for a read 6A.6 then deliberately never served.
      A window can now span a rate change, so the telescope is simply wrong,
      and a dead function that computes a wrong number is worse than no
      function: the working agreement's rule about superseded wrappers.
      **Facility overhead stays undated** — a centre is the only thing 6E can
      buy into or out of; a facility-level action would make it a `DatedRate`
      too.
      **The loader now pre-multiplies both rates** — standing by machines
      (the rate is per machine since 6E.1) and wages by `operators` rather
      than by capacity — so the engine still knows nothing about either. Both
      multiplications are no-ops on today's data by construction, since the
      migration backfilled operators to the machine count and every centre has
      one machine.
      A `simulateBatch` test pins the property the design rests on: a rate
      dated *inside* a batch splits identically one-batch-vs-three, so
      chunking stays safe even though the lock means a real batch never spans
      a change.
- [x] 6E.3 Engine: effective capacity + the observed denominator + tests.
      `min(machines, operators)` at the loader; `TickWorkCenterMetrics` gains
      `capacity`; `aggregateMetrics` divides by summed capacity-ticks with the
      null fallback. A centre retired to zero machines observes zero
      capacity-ticks, so its utilization follows the empty-window rule already
      in the aggregate rather than dividing by zero.
      **`WorkCenterAggregate` gains `capacityTicks`** — the denominator,
      reported beside `busyMachineTicks` for the same auditing reason, and
      `observedTicks` stays as what makes it *right* (a centre created mid-run
      is not idle for time it did not exist) rather than as the denominator
      itself. The test that pins the point: a centre saturated on one machine
      for two ticks and on two machines for two more reads **100%**, where
      dividing all four by today's two machines reads 75% and hides the
      constraint in the very window opened to judge the purchase.
      **The floor takes the min too**, so the cards draw slots a part can
      actually be admitted to — a machine nobody is standing at is not a slot.
      **A consequence for 6E.5, recorded here:** the dashboard's per-centre
      Standing cost column is `rate × observedTicks ÷ dayTicks` client-side,
      and 6E makes it wrong twice over — the rate is per machine now, and both
      the rate and the machine count can move mid-window. `capacityTicks` is
      *not* the fix: rent is owed on machines whether or not anyone staffs
      them, so effective capacity-ticks is the wrong basis. Either the column
      goes or machine-ticks become their own observation; decided in 6E.5.
- [x] 6E.4 Live master data + the action API. `operators` and the three prices
      through work-centre POST/PATCH and the GETs;
      `POST /api/runs/:id/actions` — one endpoint with a discriminated-union
      body, because Track 8's tool layer wants one verb, not four — taking the
      run lock, effective from `tick_num + 1`, writing the frozen action row
      and mutating the run's own config in the same transaction;
      `GET /api/runs/:id/actions`. Capital spend into `RunSummary`,
      `RunMetrics` (windowed on `applied_at_tick`, like scrap) and `netCents`
      everywhere it is computed; `/ticks` rows gain the spend joined per tick
      in JS, the convention, so the Trends net curve cannot contradict the run
      bar; `/floor` centres gain machines, operators and the frozen prices.
      **Decided:** the two work-centre handlers drop their column-by-column
      copying for a `definedFields` helper — with seven optional fields the
      copy was the only thing that could silently forget a new column, and it
      already had (`exactOptionalPropertyTypes` is why the fields are dropped
      rather than passed as undefined).
      **Decided:** `retire_machine` and `fire_operator` refuse at zero with a
      409, while retiring *down to* zero is allowed — a centre nobody staffs
      is a legitimately terrible decision, and refusing to remove what isn't
      there is a different thing from refusing the decision.
      **Decided:** an action at a tick with no series row (tick 0, or outside
      the window) is not forced into the first visible point. The chart's
      opening balance is the total minus the window's sum, so spend before the
      window is carried there rather than misdated — the 4.2 identity doing
      its job again.
      **Exercised over HTTP end to end**, and the arithmetic came out to the
      cent: a staffed hour costs 16,875c of rent and 6,800c of wages;
      `buy_machine` at the drill press charged its frozen 120,000c and the
      next hour's rent rose to 20,625c — **exactly** one machine's 3,750c
      share, nothing else re-phased; `hire_operator` charged 28,800c and took
      wages to 8,600c, +1,800c. Summary and whole-run `/metrics` agree on all
      five P&L lines. The action's own tick sits in the window *before* the new
      rate: `?fromTick=1&toTick=3600` holds the 120,000c spend at the old rent
      rate, `3601..7200` the new rent and no spend. Four actions on one tick
      sum on that tick (−120,000c) and in its bucket; bucketed capital sums to
      the run's total. Both directions of the lock: an action into a live
      advance 409s, and an advance into a live action 409s too.
      **The lesson fell out of the smoke test unasked:** buying a second drill
      press *without hiring* left effective capacity at 1 for the whole next
      hour — the run paid the machine's rent and bought nothing — and firing
      both operators left 8 machines at `min(8, 0) = 0`, so 20,000 ticks
      burned 239,580c of rent and 27,775c of wages for zero output, with 24
      parts stuck in front of a dead constraint, `utilization: 0` and
      `capacityTicks: 0` rather than a division by zero. The smoke run was
      deleted afterwards.
- [x] 6E.5 UI. Work-centres table gains operators and the three prices.
      Simulation page gains a capital panel in the transport bar: per centre,
      buy/retire a machine and hire/fire an operator at the run's frozen
      prices, waiting out the clock's beat exactly as releasing does, since
      all three contend for the same lock. Dashboard gains a Capital card
      beside the other cost lines and the action log as a table (what, where,
      when in Day · time, what it cost); the net stat and the Trends net curve
      subtract it (`netProfit.ts` learned the fifth column, or the curve would
      contradict the run bar).
      **Decided: a dialog, not more bar controls.** Buying is a whole-factory
      question — which centre is the constraint, and which of its two halves
      is short — so the thing that answers it is a table of every centre with
      machines, operators, rent, wages and prices, and the short side of
      `min(machines, operators)` in the `starved` tone. Six more controls
      crammed into the transport bar would have shown one centre at a time.
      **Decided: the Standing cost column goes** (the 6E.3 question). It was
      `rate × observedTicks ÷ dayTicks` and 6E makes it wrong twice — the rate
      is per machine and the machine count moves mid-window — so
      `standingCost.ts` and its test are **deleted** rather than patched, and
      the column is replaced by Machines / Operators (current config, labelled
      as such, operators tinted when the two disagree) plus `capacityTicks`
      beside `busyMachineTicks`: the utilization fraction's own two halves.
      Machine-ticks as a second observation would have bought the old column
      back honestly, and nothing yet needs it.
      **The floor calls out the waste rather than hiding it:** a centre with
      two machines and one operator drew "1/1" once capacity went effective,
      so the row now appends `+1 unstaffed` (or `+1 idle` the other way) — the
      rent-with-no-output the model started charging for in 6E.3 is exactly
      what a floor view should show.
      **A refactor the unit forced, and worth it:** the work-centre editor's
      numeric columns became a spec (`src/setup/workCenterFields.ts`, pure and
      tested, 10 cases) driving the create dialog, the draft, the parse and the
      changed-column diff. Seven fields declared, validated and diffed by hand
      is ~110 lines of copy per new column *and* a silent failure mode — a
      column editable but never committed, the same class of bug the backend
      handlers had in 6E.4. Table cells stay explicit per column, which is what
      the tables-aren't-data-driven convention is about.
      **Not verified in a browser:** the Chrome extension was not connected
      this session, so the UI is typechecked, linted and unit-tested only. The
      3.4 lesson stands — "create then read" and every other first-paint case
      is exactly what headless checks miss — so this owes a hands-on pass,
      and 6E.6 should not be treated as closing the track until it has had one.
- [x] 6E.6 Doc sweep. CLAUDE.md was kept current unit by unit — four costs
      became five, the frozen-config invariant gained its first sanctioned
      writer, `accrueRate`'s formula gained its epoch, the observation gained
      its own denominator, and the frontend sections gained the capital dialog,
      the log and `workCenterFields.ts` — so this unit is the README.
      **Two open questions close**, and both kept on the page with their
      answers because the answers shaped the track: capital spend is a **lump**
      (the argument is timescale, not simplicity — a realistically amortised
      machine is ~$11/day against a ~$1,900/day factory, so it would be free
      inside a run and "always buy" would win, the degenerate objective 6A
      exists to prevent), and a run **can** edit its own config, but only
      through an action that charges for it: `run_work_centers` has exactly one
      writer, and free editing was never the question worth answering.
      Phase 4's capital bullets are struck through with what was *not* built
      named beside them — a bought machine is capacity at an **existing**
      centre (a new one nothing routes to would need routings changed mid-run),
      letting an operator go is free on purpose, and add-a-shift/overtime moved
      to 6F. "Payback period" is marked delivered as something **readable**
      rather than reported: the lump makes the net curve step down, and a
      *number* needs Track 7's two runs side by side. Phase 4 stays *partly
      delivered* — rework, the penalty halves of 6B and 6C, and 6F are still
      out. The master-data list keeps **shift calendars** and gives up wage and
      per-centre rates; Phase 5's "buy a machine, add a shift" notes that two
      of its levers already exist and what forking actually adds.
- [x] 6E.7 Fix: a whole-run window began at tick 1, so **tick-0 capital was
      invisible to `/metrics`**. Found while proving 6G.1a a no-op, by
      re-reading the 6H.1 playthrough: the summary said the run netted $42,444
      and whole-run `/metrics` said $45,652, and the gap was exactly the $3,208
      the run opened by spending. `tickWindow` defaulted `from` to 1 because
      ticks are numbered from 1 — but a capital action is an **event at a
      tick**, not an accrual across one, and tick 0 is a real moment at which
      money is spent: it is the moment a machine is worth buying, before the
      first advance, which is precisely what the capital dialog invites. So the
      P&L pane read a run better than it was while the run bar beside it told
      the truth, and the more sensibly a run was played the wider the two
      diverged.
      **The fix is `from: fromTick ?? 0`** — the default window is the whole
      run, and a run begins at tick 0. Nothing else moves: no tick, finished
      part or scrapped part is ever numbered 0, so every other query returns
      the same rows, and `/ticks` still drops a tick-0 action from the series
      rather than misdating it into the first visible point (its bucket index is
      −1, which no row has) — 6E.4's decision, left standing, with the chart's
      opening balance carrying that spend as it was designed to.
      **Deliberately not changed:** an *explicit* `?fromTick=1` still excludes
      tick 0, and the dashboard's post-jump window (`startTick + 1 …`) still
      does too. That is coherent rather than a leftover — capital committed
      before a jump is not that jump's spend — and the bug was only ever in
      what "whole run" defaulted to.
      Verified over HTTP against the playthrough: summary and whole-run
      `/metrics` now agree to the cent on all five P&L lines; `[57600, 57600]`
      still holds that tick's $792 of cutter spend and `[57601, 60000]` none of
      it (the action's own tick sits before the rate it bought, 6E.4's
      arithmetic intact); a backwards window still 400s.

### Track 6F — Shift calendar and overtime (`feat/overtime`) — re-plan when reached

Split out of 6E on 2026-09-04 (user call). Authorize overtime for a period,
and change shifts mid-run.

**Why it is not in 6E.** Overtime's whole economic identity is the **premium**:
priced at the normal wage it costs exactly what a temp's hour costs and needs
no hiring, so it strictly dominates both the shifts setting and 6E's hire/fire
and the decision collapses. Pricing it therefore comes first — the leaning is
a single facility-wide multiplier in basis points (15000 = time and a half),
frozen per run like every other rate, rather than a second wage column per
centre nothing yet reads.

**What it actually costs to build.** Both overtime and a mid-run shift change
make a run's calendar day **non-uniform**, and `day_ticks` is a single frozen
integer that two things multiply against: `loadRunState`'s
`dueDay × dayTicks`, and every rate's `floor(t·r/D)` amortization. So a run
needs a day-boundary table (`run_days`: day number, start tick, width) and
"which day is tick 41,000 in" becomes a lookup rather than a division.
**Recorded leaning (user's): authorize mid-day**, standing inside the day being
extended, rather than the easier schedule-ahead form — which means 6F also
owes the accrual rework, because rent is a per-day rate amortized across the
day's staffed ticks and stretching a day already in progress charges that day
more than one day's rent. Scheduling ahead is the cheap version and stays the
fallback if the rework proves out of proportion.

### Track 6G — Simulator throughput (`perf/observation-buckets`)

Planned 2026-09-04, from driving 6E: fast-forwarding is slow, and slow enough
that a horizon long enough to pay back a machine (6H) is not playable. Both
halves were **measured before planning**, because 6A.10b's lesson was that the
obvious culprit was the wrong one.

**Measured** (dev database, seeded factory of six centres, 20,000 ticks per
advance):

| floor | pure simulation | wall clock | rows written |
| --- | --- | --- | --- |
| empty | 43 ms | **8.2 s** | 140,000 |
| 172 WIP | 295 ms | **9.4 s** | 140,000 |
| 500 WIP | 901 ms | — | 140,000 |
| 2,000 WIP | 4,177 ms | — | 140,000 |

**The diagnosis, and it is not what it looked like.** An *empty* floor costs
8.2 s per 20,000 ticks, so the cost is **per tick, not per part**: 140,000
observation rows go to Neon whatever is happening, and at today's book the
database is ~97% of the wall clock. WIP is a second, independent curve — the
pure tick loop is O(WIP) and reads 465k ticks/s empty, 68k at 172, 22k at 500
and 4.8k at 2,000 — so it only becomes comparable past ~500 parts, which is
exactly where 6H's deeper book would put it. Reads are fine and stay fine:
`/floor` 124 ms, summary 92 ms, whole-run `/metrics` 460 ms over 20,000 ticks,
`/ticks?bucket=60` 133 ms.

- [ ] 6G.1 Per-minute observation buckets — the lever 6A.10b named and
      deferred. `run_ticks` and `run_tick_work_centers` become one row per
      **simulated minute**: 60× fewer rows, so a day of writes goes from
      ~200k rows to ~3.5k and ~12 s to well under a second.
      **Every aggregate stays exact**, which is what makes this safe rather
      than a resolution compromise: a bucket stores *sums* (throughput,
      expense, carrying, wages; per centre, busy machine-ticks, capacity-ticks
      and queued part-ticks), a *max* (worst queue depth) and one *level* (WIP
      at bucket end) — and every figure `aggregateMetrics` reports is built
      from precisely those, so utilization, mean and worst queue and mean WIP
      come out identical. What actually coarsens is **window resolution**: a
      window whose bounds fall mid-minute covers the containing minutes, and
      the label already comes from the response, which is the rule that makes
      that honest. Also gone is the per-*second* series, which
      `chartBucket` already stops asking for past 5,000 ticks.
      Open when this is built: whether `run_ticks` keeps its name (the row is
      no longer a tick), and whether the bucket width is a constant or frozen
      per run like `day_ticks` — a fork comparing two runs must bucket both
      the same way.
- [ ] 6G.2 Clone on write in the tick loop. Every tick copies **every** WIP
      part (`{ ...source }`) and rebuilds the claims array, so 2,000 parts over
      20,000 ticks is 40 million object clones — and a part that sits queued
      changes nothing, so its clone is pure waste. Pass unchanged parts through
      by reference and clone only what a tick actually advances; the
      no-mutation contract holds either way, since nothing mutates a `WipPart`
      in place.
      **A characterization test comes first**, written against the current
      implementation and pinned: a heavy-WIP batch's finished ticks, scrap and
      money, so the optimization is provably byte-identical rather than
      probably. The one-batch-vs-several test is the other half.
- [ ] 6G.3 Refresh cadence during a jump. The jump loop calls `refresh` after
      every committed hour — `GET /:id` plus `GET /:id/floor`, ~216 ms
      together — which is ~1.7 s of a simulated day and ~17 s of a ten-day
      jump spent on reads nobody is looking at mid-flight. The advance result
      already carries the tick number, WIP count, all five money lines and the
      scrap count, so the transport bar can be driven from it and the floor
      refreshed on a slower cadence (and always at the end). Cheap, and it cuts
      server load on exactly the operation that is already heaviest.

### Track 6H — Demand deep enough to pay back a decision (`feat/demand-depth`)

Planned 2026-09-04, from driving 6E: **buying capacity always loses**, and the
reason is the order book, not the prices.

**The arithmetic, since "the pricing might be off" deserves a number rather
than a nudge.** A fed one-press factory earns 60 brackets × 4,800c = 288,000c
of margin a day against 189,400c of cost (135,000c rent and overhead, 54,400c
wages) — **+98,600c/day**. A second press plus its operator costs 44,400c/day
more and doubles the constraint, so a fed two-press factory earns
576,000c − 233,800c = **+342,200c/day**, and the 148,800c it costs to buy and
staff pays back in **0.6 of a fed day**. The prices are not the problem.

**The problem is that "fed" runs out.** The seeded book is 172 units ≈ 2.9
drill-days at one press and 1.4 at two, and a factory with an empty floor
still burns 189,400c a day — so every tick past the drain is loss, and a run
long enough to *look* like a payback horizon spends most of it bleeding. Two
presses reach the drain sooner and then bleed faster. That is a real result,
and it is also unplayable as the only result.

**Three things this is not.** Not a pricing bug (above). Not a reason to
cheapen capital: a machine priced to pay back inside a 3-day book makes the
decision trivial, and 6E rejected the same move in amortised form. And not
entirely a bug at all — *retiring machines and firing operators to stop the
bleed is now a legal and correct answer*, which 6E made possible without
anyone planning it as demand management.

**One trap found while driving it, worth fixing separately:** adding a *new
work centre* charges rent and wages from the next run's creation while no
routing visits it, so it can never produce — and `operators` defaults to 1, so
it draws a wage immediately. Buying capacity anywhere but the constraint has
the same shape. The model is right; the UI gives no signal at all.

- [x] 6H.1 A book that spans a horizon — seed only, no engine change. **Taken
      out of order, ahead of 6G** (user call 2026-09-04: "i wanna deviate from
      the track and make my seeded data have more parts many orders and stuff
      so i can do long runs without having to manually create orders"), and
      scoped wider than this entry planned: a **playground** default, not a
      tuned three-order lesson. As landed: **ten** work centres (Lathe, CNC
      Mill, Welding and Paint Booth join the original six), **ten** parts each
      with a full routing, and **29 sales orders / 3,600 sold units** in three
      demand waves across due days 2–18.
      **Decided: the 6B/6C tuned stories are gone, not preserved.** This entry
      asked to keep SO-2001's tight day-1 promise and SO-2003's starve-contingent
      day 3 as the book's first days. They could not survive a ten-centre floor
      — every one of those margins was computed against a six-centre factory's
      ~$1,894 staffed day, and the new floor's base burn is ~$3,340 — so the
      whole book was retuned rather than half-retuned. What replaces them is a
      *ladder* rather than a single tight promise: drill demand is ~23.5
      press-days against an 18-day book, so wave 1 (due 2–6) is makeable on the
      starting factory, wave 2 (8–12) needs the second press and mill, and wave
      3 (14–18) needs them bought early. The 6C setup and scrap stories carry
      over intact in shape — spares are now sized per work order at 1.5× the
      routing's expected loss plus one, so overage is a rule rather than one
      hand-picked pair.
      **The seed is data-driven now** — `CENTER_SPECS`, `PART_SPECS`,
      `ORDER_BOOK` and a `spareUnits` rule — because at ten centres and 29
      orders the hand-written form had the failure mode `workCenterFields.ts`
      was built to kill: a column or an order edited in one of four places.
      Capital prices are *computed* from 6E.1's rules (4 days of standing cost
      to buy, half back as salvage, 16 wage-hours to hire) rather than typed,
      so retuning a rate can no longer leave a price behind.
      **Verified live, and it answers what 6E.1 could only assert on paper.**
      One full playthrough (run "Playground shakedown", seed 4243, ~432,000
      ticks): second press + mill bought at tick 0 and a second cutter on day 2
      ($4,000 of capital), releases staged wave by wave — **net +$42,444 on
      $120,815 of throughput, 100% OTD, all 29 orders shipped in full**, floor
      drained end of day 15. Net went **negative on day 1** (−$1,707, paying for
      the machines), crossed zero on day 2, then ran ~$5–6k a day. Drill Press
      read **82.7% utilization with two presses**, so one press is ~1.65×
      overloaded and the late waves cannot ship on time without the buy — the
      payback horizon 6H exists to create. Two honest counterweights showed up
      unasked: the second **mill** ran only 32.3%, so it was due-date insurance
      rather than a profit machine, and a thin patch in my own release schedule
      left the floor **empty most of day 8**, which burned $4,051 of net against
      $495 earned — an idle expanded factory is the most expensive thing in the
      game, exactly 6A's lesson at ten times the scale.
      **6G is now owed rather than assumed.** This entry said "depends on 6G";
      it landed first, and the cost is measurable but not blocking: ~14,400
      ticks per 8–13 s (~5 minutes of wall clock for the 15-day playthrough),
      with WIP peaking at 865 parts — past the ~500 where 6G.2's clone-on-write
      curve bites, and ~5M observation rows where 6G.1's buckets would have
      written ~85k.
- [ ] 6H.2 Buy at the constraint, not at random — the affordances that make
      the decision legible. The capital dialog gains each centre's
      **utilization over the run so far** (it already fetches `/metrics` for
      the dashboard), so the constraint is visible where the money is spent;
      a centre no routing step visits is marked as such in setup and in the
      dialog, since capacity there can never produce; and a new work centre
      defaults to **zero operators**, so adding one to the factory does not
      silently start a wage.
- [ ] 6H.3 Rolling demand — re-plan when reached, and the actual fix. Orders
      that *arrive* over time from a seeded arrival process rather than a book
      fixed at seed time, so a run has an indefinite horizon, capacity has
      time to earn, and "release less" trades against "miss the next order".
      It is also what a Track 8 agent should face: a stream of decisions, not
      one shot at a static book. New randomness, so it needs a draw domain of
      its own (the 6C pattern) and must stay reproducible from `rng_seed`
      alone. Deliberately behind Track 7: forking is load-bearing for the
      agent, and a deep static book is enough to make a fork comparison mean
      something.

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
