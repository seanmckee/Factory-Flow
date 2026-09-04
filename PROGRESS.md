# Build progress

Operational ledger for the road to the AI agent. The README holds the narrative
arc and `CLAUDE.md` the design invariants; this file answers **"what do I do
next"** in one screen.

**One unit = one commit = one review checkpoint.** Tick a box in the same commit
that completes it. Done units collapse to one line — the reasoning lives in the
commit that made the change and in `CLAUDE.md`, not here.

---

## You are here

**Track 6 is complete through 6E** (2026-09-04): the run has a five-line P&L —
throughput − operating expense − carrying − wages − capital — and a score that
can go negative. 6E was the first thing that changes a run's **own frozen
config** while it is alive, and its UI has had its hands-on browser pass.

**6G.1 and 6H.1 landed early, both out of order.** Observations are stored per
simulated minute (advancing an empty floor 8.9 s → 1.9 s per 20,000 ticks;
whole-run `/metrics` on the 15-day playthrough 7.4 s → 1.13 s; every reported
figure byte-identical across the migration). The playground seed gives a book
with a horizon: 10 centres, 10 parts, 29 orders / 3,600 units, due days 2–18.

**Next: Track 7 (forking) → Track 8 (the agent).** The remaining sim units —
6G.2, 6G.3, 6H.2, 6H.3 — are **deferred behind both** (user call, 2026-09-04).
The sim is done: it has a five-line P&L, a book with a horizon, and an API an
agent can already drive. What is left there is polish and perf, and playing the
sim kept generating more of it — 6F, 6G and 6H were all invented while driving
6E. Pick them up after the agent, if its behaviour shows they are needed.

---

## Next, in order

### 6G — Simulator throughput (`perf/observation-buckets`)

- [ ] **6G.2 Clone on write in the tick loop.** Every tick copies **every** WIP
      part (`{ ...source }`) and rebuilds the claims array, so 2,000 parts over
      20,000 ticks is 40 million object clones — and a part that sits queued
      changes nothing, so its clone is pure waste. Pass unchanged parts through
      by reference and clone only what a tick actually advances; the
      no-mutation contract holds either way, since nothing mutates a `WipPart`
      in place. Bites past ~500 parts; the 15-day playthrough peaked at 865.
      **A characterization test comes first**, written against the current
      implementation and pinned: a heavy-WIP batch's finished ticks, scrap and
      money, so the optimization is provably byte-identical rather than
      probably. The one-batch-vs-several test is the other half.

- [ ] **6G.3 Refresh cadence during a jump.** The jump loop calls `refresh`
      after every committed hour — `GET /:id` plus `GET /:id/floor`, ~216 ms
      together — which is ~1.7 s of a simulated day and ~17 s of a ten-day jump
      spent on reads nobody is looking at mid-flight. The advance result already
      carries the tick number, WIP count, all five money lines and the scrap
      count, so the transport bar can be driven from it and the floor refreshed
      on a slower cadence (and always at the end).

### 6H — Demand deep enough to pay back a decision (`feat/demand-depth`)

Planned 2026-09-04 from driving 6E: **buying capacity always lost**, and the
reason was the order book, not the prices. The arithmetic, since "the pricing
might be off" deserves a number: a fed one-press factory earns 288,000c of
margin a day against 189,400c of cost — **+98,600c/day**. A second press plus
its operator costs 44,400c/day more and doubles the constraint, so a fed
two-press factory clears **+342,200c/day**, and the 148,800c to buy and staff it
pays back in **0.6 of a fed day**.

- [ ] **6H.2 Buy at the constraint, not at random** — the affordances that make
      the decision legible. The capital dialog gains each centre's
      **utilization over the run so far** (it already fetches `/metrics` for
      the dashboard), so the constraint is visible where the money is spent; a
      centre no routing step visits is marked as such in setup and in the
      dialog, since capacity there can never produce; and a new work centre
      defaults to **zero operators**, so adding one to the factory does not
      silently start a wage.

- [ ] **6H.3 Rolling demand** — re-plan when reached. Orders that *arrive* over
      time from a seeded arrival process rather than a book fixed at seed time,
      so a run has an indefinite horizon, capacity has time to earn, and
      "release less" trades against "miss the next order". It is also what a
      Track 8 agent should face: a stream of decisions, not one shot at a static
      book. New randomness, so it needs a draw domain of its own (the 6C
      pattern) and must stay reproducible from `rng_seed` alone.

### Track 7 onward — re-plan when reached

- [ ] **Track 7** `feat/run-forking` — fork at a checkpoint, compare on net
      profit. What all of Track 6 exists to make meaningful, and 6E gave it its
      sharpest question: fork, buy the second drill press in one branch only,
      and read the payback off the two net curves. Depends on the seeded RNG
      (1.2) and on the draw key being uuid-free (3.2b).
- [ ] **Track 8** `feat/agent` — tool layer: create, advance, fork, read
      metrics, compare.

### Track 6F — Shift calendar and overtime (`feat/overtime`) — deferred

Split out of 6E (user call, 2026-09-04) and parked **behind Track 7**: forking
is load-bearing for the agent, overtime is one more lever.

**Why it isn't cheap.** Overtime's whole economic identity is the **premium**:
priced at the normal wage it costs exactly what a temp's hour costs and needs no
hiring, so it strictly dominates both the shifts setting and 6E's hire/fire, and
the decision collapses. Pricing comes first — leaning is a single facility-wide
multiplier in basis points (15000 = time and a half), frozen per run like every
other rate. And both overtime and a mid-run shift change make a run's calendar
day **non-uniform**, while `day_ticks` is a single frozen integer that two
things multiply against: `loadRunState`'s `dueDay × dayTicks`, and every rate's
`floor(t·r/D)` amortization. So a run needs a day-boundary table (`run_days`:
day number, start tick, width) and "which day is tick 41,000 in" becomes a
lookup rather than a division. **Recorded leaning (user's): authorize mid-day**,
standing inside the day being extended, which also owes the accrual rework —
stretching a day already in progress charges that day more than one day's rent.
Scheduling ahead is the cheap fallback if the rework proves out of proportion.

---

## Decisions that still bind

Design invariants live in `CLAUDE.md`. These are the ones about *sequence and
scope* that would otherwise be re-argued:

- **Track 7 comes before Track 8, and forking *is* load-bearing** (user call,
  2026-09-04, reversing the note below). Comparison is the agent's whole
  mechanism: it is how the agent tells a decision that paid from one that did
  not. An agent that can only play forward has no control to measure against.
- **The remaining sim units are deferred behind the agent.** 6G.2 (clone on
  write) is the only one the agent itself benefits from, and it is a bounded
  perf fix rather than a prerequisite; 6G.3 is a UI cadence an agent never
  triggers, 6H.2 an affordance for a human reading the dialog when the agent
  reads `/metrics` directly, and 6H.3 changes the shape of the task rather than
  enabling it.
- **Track 6F waits behind Track 7.** See above.
- **Shortest path to an agent** (asked 2026-09-03): 3.2a → 3.2 → 3.3 gets an
  HTTP API an agent can drive. Track 6 is what makes driving it *mean*
  something, because without it money only goes up and "release everything"
  wins by default. Skippable until after the agent: 3.4, 3.5, Track 5 and most
  of Track 4. It also held that Track 7 forking was not load-bearing, since two
  runs from the same seed and config with different policies is already a valid
  comparison (true only because of 3.2b) — **superseded above**: a fork from a
  checkpoint compares two policies over a shared history, which is the question
  the agent is actually asking.
- **Deeper carving of `runService`, and the `SimulationPage` hooks
  (`useRunClock`, `useRunJump`), wait until after Track 7.** Boundaries invented
  ahead of the code that uses them are the ones you end up fighting.
- **Why Track 6 was worth it:** 6A made the score able to go *down*, which is
  what makes an agent's objective non-degenerate; 6B added a promise the agent
  can break without buying anything with it; 6C made batch size a real decision
  and output itself unreliable; 6D priced the staffed hour; 6E is the first
  decision that costs money up front and changes the factory afterwards — which
  is what a fork is *for*.

**Playthrough baseline** (15 days on the playground seed, for comparison when
6G.2 and 6H land): expanded early it nets **+$42,444 at 100% OTD**, the drill
press reads 82.7% *with two presses*, one idle day costs $4,051, and the run
spans ~5 wall-minutes and ~5M observation rows.

---

## Done

### Unit 0 — Ledger
- [x] `docs/build-ledger` — this file + the `CLAUDE.md` pointer

### Track 0 — Infrastructure
- [x] `chore/backend-outdir` — `rootDir`/`outDir`, so `tsc` stops emitting into `src`
- [x] `chore/backend-vitest` — vitest on `environment: node`; `"types": []`, so test globals are imported

### Track 1 — Engine to the backend (`feat/engine-to-backend`)
- [x] 1.0 `calculateThroughput` takes `Map<workOrderId, priorCount>` rather than the whole finished history
- [x] 1.1 `simulation/types.ts` — narrow structural types Drizzle rows satisfy without mapping
- [x] 1.2 Port `sampleProcessTime` + `simulateTick` + tests; the RNG is seeded per run
- [x] 1.3 Port `calculateThroughput` + tests; `smoothThroughput` dropped as dead code

### Track 2 — Instrumentation (`feat/simulation-metrics`)
- [x] 2.1 `TickMetrics` **emitted by the tick** — `wipCount` plus per-centre `busy`/`queued`
- [x] 2.2 `metrics.ts` — `aggregateMetrics` over a window: utilization, queue depth, WIP
- [x] 2.3 Cycle time — `releasedAtTick` on `WipPart`, carried onto `FinishedPart`; median + p95, nulls on empty

### Track 3 — Run persistence (`feat/run-persistence`)
- [x] 3.1 Schema + migration — the run tables; pinned steps decided as a snapshot
- [x] 3.1b Re-key pinned steps per **work order** at release; capacity frozen into `run_work_centers`
- [x] 3.2a `creditFinishedParts` — per-part money attribution; `calculateThroughput` becomes its sum
- [x] 3.2 Run service split on the pure/impure line — `simulateBatch` pure, `runService` loads and writes
- [x] 3.2b Fix the draw key to `(seed, workOrderId, unitIndex, stepIndex)` — uuids made same-seed runs diverge
- [x] 3.3 Routes — `src/routes/runs.ts`, the only router with no DB code in it
- [x] 3.4a Floor and tick-series reads — `deriveFloorView`; `/ticks` capped at 5000 rows
- [x] 3.4 Frontend switchover **and** deletion of the frontend engine, one commit
- [x] 3.5 Doc sweep — the README's "entirely ephemeral" limitation closed

### Track 4 — Fast-forward (`feat/run-fast-forward`)
- [x] 4.1 `AdvanceResult.wipCount` — a jump terminates on the advance's own answer
- [x] 4.2 `openingCents` + a seeded `cumulativeThroughput`, so a capped series doesn't re-base
- [x] 4.3 Jump controls, chunked to match `TICKS_PER_BATCH`; Stop lands on a committed boundary
- [x] 4.4 `RunMetricsStrip` — one row from `/metrics`, explicitly a placeholder (replaced in 5.3)
- [x] 4.5 "Clear stale lock" on the 409, worded as an assertion rather than a retry
- [x] 4.6 Doc sweep, plus two 3.4 leftovers in `CLAUDE.md`

### Track 4.5 — Dark redesign (`feat/dark-theme-shell`)
- [x] `feat/theme-tokens` — `@/` alias, shadcn on zinc, semantic tokens + `running`/`starved`/`saturated`
- [x] `feat/app-shell` — `h-dvh` shell; pages own the viewport, regions scroll
- [x] `feat/ui-primitives` — shadcn primitives replace the hand-rolled ones; the toast stays ours
- [x] `feat/list-pages` — five list pages: `PageHeader` + "New …" dialog + sticky-header table
- [x] `feat/simulator-layout` — control bars + tabs; `WorkCenterTable` in stable name order
- [x] `fix/release-race` — releasing waits out the clock's beat; the picker hides released orders
- [x] `docs/style-convention` — the styling convention in `CLAUDE.md`

### Track 5 — Run dashboard (`feat/run-dashboard`)
- [x] 5.1 `throughputRate` — the trailing rate, successor to the deleted `smoothThroughput`
- [x] 5.2 Rate + WIP charts beside the cumulative curve
- [x] 5.3 `RunDashboard` replaces `RunMetricsStrip` — stat cards over a work-centre table
- [x] 5.4 Doc sweep
- [x] 5.5 Chart hints + honest tab names (Floor / Trends / Dashboard)

### Track 6A — P&L core (`feat/operating-expense`)
- [x] 6A.0 `refactor/run-service-reads` — reads to `runReads.ts`, `loadRunState` to `runState.ts`
- [x] 6A.1 Schema + migration + seed retune — `factory_settings`; standing cost frozen per run
- [x] 6A.2 `operatingExpense.ts` + tests — `accrueRate`, an exact integer floor-diff needing no cursor
- [x] 6A.3 `simulateBatch` wiring + tests — `RunState.costs`, `carryRemainder` carried out
- [x] 6A.4 Live-rate API — standing cost on work centres; `GET/PATCH /api/settings`
- [x] 6A.5 Freeze at create, accrue on advance
- [x] 6A.6 P&L reads — `netCents` on the summary, the same lines windowed on `/metrics`
- [x] 6A.7 UI: standing-cost column + the Factory Settings page
- [x] 6A.8 UI: pure transforms — `simTime.ts`, `netProfit.ts`
- [x] 6A.9 UI: the net-profit curve **overlaid** on the cumulative chart, not a fourth card
- [x] 6A.10 UI: dashboard P&L — net profit leads, destructive when negative
- [x] 6A.10a Transport catches up with the day scale (first hands-on)
- [x] 6A.10b Advance throughput + streaming jumps; the blocking modal deleted
- [x] 6A.10c Whole-run charts + drain-stop (second hands-on)
- [x] 6A.10d One Trends chart, hideable lines, Day·time axis (user call: three cards hid the relationships)
- [x] 6A.10e Durations read in hours past two staffed hours

### Track 6B — Due dates and on-time delivery (`feat/due-dates`)
- [x] 6B.1 Schema + migration + seed — nullable `due_day`, frozen nullable `due_at_tick`
- [x] 6B.2 Engine + tests — `dueAtTick` required-nullable; on time is `completedAtTick <= dueAtTick`
- [x] 6B.3 API — day → tick converted in `loadRunState`, the one place it happens
- [x] 6B.4 UI + doc sweep — Due column, OTD card
- [x] 6B.5 Per-sales-order delivery breakdown — an aggregate can't say *which* promise broke

### Track 6C — Setup and scrap (`feat/setup-scrap`)
- [x] 6C.1 Schema + migration + seed retune — `scrap_bps`, `setup_started_at_tick`
- [x] 6C.2 Engine: setup + tests — machine time, admission-pays, one changeover per (work order, step)
- [x] 6C.3 Engine: scrap + tests — `unitDraw` gains a draw domain; the legacy key stays byte-identical
- [x] 6C.4 API — `scrapBps` through the step schemas, defaulted to 0 so pre-6C payloads stay valid
- [x] 6C.5 UI + doc sweep — scrap entered as a percentage, sent as bps

### Track 6D — Shifts and wages (`feat/shift-calendar`)
- [x] 6D.1 Schema + migration + seed — `factory_settings.shifts`, `wage_cents_per_hour`
- [x] 6D.2 Engine: wages + tests — paid per **staffed hour**, its own P&L line
- [x] 6D.3 API — shifts and wages frozen per run
- [x] 6D.4 UI + doc sweep — Shifts setting, Wage column, Wages card

### Track 6E — Capital actions (`feat/capital-actions`)
- [x] 6E.1 Schema + migration + seed — `operators`, the three prices, `run_capital_actions`
- [x] 6E.2 Engine: effective-dated accrual + tests — `accrueRate` gains a `sinceTick`
- [x] 6E.3 Engine: effective capacity + the observation's own denominator + tests
- [x] 6E.4 Live master data + the action API — one endpoint with a discriminating `kind`
- [x] 6E.5 UI — the capital dialog (a dialog, not more bar controls), the log, the fifth P&L line
- [x] 6E.6 Doc sweep
- [x] 6E.7 Fix: a whole-run window begins at tick **0** — tick-0 capital was invisible to `/metrics`
- [x] 6E.8 Hands-on browser pass — a stale dashboard, the dialog's width, an unordered floor query, the rate axis
- [x] 6E.9 The floor says what is released, not every routing
- [x] 6E.10 Dropdowns default to `popper`, so a picker can't open off the top of the window

### Track 6G — Simulator throughput (`perf/observation-buckets`)
- [x] 6G.1a Pure layer — `observationBuckets.ts`; aggregates take buckets, not ticks
- [x] 6G.1b Storage on the grid — `run_buckets` replaces `run_ticks`, one row per simulated minute
- [x] 6G.1c Frontend + docs — `chartBucket` never asks finer than the stored minute

### Track 6H — Demand depth (`feat/demand-depth`)
- [x] 6H.1 The playground seed — a book that spans a horizon (taken out of order, user call)
