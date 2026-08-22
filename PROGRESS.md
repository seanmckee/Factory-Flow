# Build progress

Operational ledger for the road to the AI agent. The README holds the narrative
ten-phase arc; this file answers "what do I do next" in one screen.

**One unit = one commit = one review checkpoint.** Tick a box in the same commit
that completes it.

---

**You are here:** Track 0 — `chore/backend-outdir` done.

**Next up:** `chore/backend-vitest`.

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
- [ ] `chore/backend-vitest` — backend has no test runner at all. `environment:
      node`, mirroring the frontend. Note `"types": []` in tsconfig: import test
      globals explicitly.

## Track 1 — Engine to the backend (`feat/engine-to-backend`)

Move before instrumenting, so new engine code isn't written in the frontend and
immediately relocated. The backend owns the engine; the frontend keeps
hand-written type mirrors, as it already does for every API shape. No workspace
tooling — the two tsconfigs are actively incompatible (frontend is `bundler` +
**`strict` off**, backend is `nodenext` + strict + `noUncheckedIndexedAccess`).

- [ ] 1.0 Refactor `calculateThroughput` to take `Map<workOrderId, priorCount>`
      instead of the whole finished history. **Frontend, under the existing
      tests**, before anything moves — it's O(n²) today and it's what would force
      a persisted run to reload its entire history every tick.
- [ ] 1.1 `backend/src/simulation/types.ts` — a retyping, not a copy. The Drizzle
      types are different shapes.
- [ ] 1.2 Port `sampleProcessTime` + `simulateTick` + tests. Strip the per-draw
      `console.log`. **Seed the RNG here** (decided 2026-08-22): `rng_seed` on
      the run, or make the draw a pure function of `(seed, part_uuid,
      step_index)` so it needs no persisted cursor. Without this, Track 7's fork
      comparison measures noise rather than the decision that changed.
- [ ] 1.3 Port `calculateThroughput` + tests. Don't port `smoothThroughput` —
      dead code, superseded by Track 5.

## Track 2 — Instrumentation (`feat/simulation-metrics`)

The "observations" half the agent needs. Today the only observation is money.

- [ ] 2.1 Utilization, queue depth, WIP count — generalise the logic already in
      `deriveWorkCenterView`, which computes this for display only.
- [ ] 2.2 Cycle time. **Open decision:** needs `releasedAtTick` on `WipPart`,
      which changes the engine's core type.

## Track 3 — Run persistence (`feat/run-persistence`)

Where a run becomes a server-side object an agent can address.

- [ ] 3.1 Schema + migration — five tables. `run_finished_parts` carries **frozen
      money columns**, because allocations mutate and would otherwise silently
      rewrite a finished run's chart. No `work_center_id` on `run_wip_parts` —
      derive it.
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
`stepIndex >= steps.length`. `simulationTick.ts` indexes `steps[stepIndex]` at
four sites with no guard and the frontend has `strict` off, so this is a live
crash reachable through the routing editor. The backend's stricter flags will
force it to be handled during the Track 1 port — a bare `continue` would freeze
the part in WIP forever.
