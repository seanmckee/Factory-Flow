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

**Track 7 (forking) is complete** (2026-09-04): `POST /api/runs/:id/fork`
copies a run at its current tick under the parent's lock, the branches replay
byte-identically from the shared seed until a decision diverges them (verified
end-to-end by `npm run check:fork`), and the Trends chart overlays a compared
run's net curve with a fork-seam line — the payback of one decision, read off
two nets.

**Release policies (RP) are complete** (2026-09-04): a run can feed its own
floor while it advances — CONWIP, due-date scheduling, or drum-buffer-rope,
EDD priority throughout — with defaults in Factory Settings, a frozen per-run
copy changeable any time under the run's lock, and fork isolation proven
end-to-end by `npm run check:policy`. A jump now drains only when the floor
and the releasable backlog are both empty.

**Track 8 phases 1 and 2 are complete** (2026-09-07): the `agent/` service
(Python FastAPI + LangGraph, OpenAI models via `OPENAI_MODEL`) hosts an
analyst over the backend's REST API that can now **act** — fork, advance,
capital action, release policy, manual release — with every write held at a
**human approval gate**. The graph is hand-authored for that reason: reads
route past the gate, writes suspend it, and the card a person approves is
built from the sim rather than from the model's arguments. The LangSmith suite
scores **7/7**, one example now scoring conduct (did it stop?) rather than
prose.

**Track 8 phase 3 is complete** (2026-09-08): the agent runs experiments
rather than describing them. The **verdict is computed** — a pure comparator
over two runs' frozen P&L columns, drawn in the transcript as the table it is,
with a link to the two net curves on Trends — and **authority is granted per
experiment** rather than per HTTP call. Running two branches for 15 days used
to cost ~44 approvals, 43 of them "yes, keep going"; chunking the advance
inside its tool took that to one without touching authority, and a budgeted
plan (which runs, which verbs, how far, how much) took the rest. The gate is
still structural: a grant can only *skip a pause it covers*, so the failure
mode of a wrong one is an extra question, never an unapproved write — and the
grant is visible while it stands and revocable. Replies render as markdown,
and three eval examples now score **conduct** rather than prose.

**Next, if the agent continues: the role split** the comparator justifies —
supervisor over a read-only analyst, an experiment runner, the deterministic
comparator and a verdict writer. It is now the boundary that pays, since the
comparator is the node that needs no model at all. `InMemorySaver` is the
first thing to fix if it does continue: it drops granted plans on restart.

**One sim unit stopped being optional: 6H.3, rolling demand** (user call,
2026-09-08). Running phase-3 experiments showed the comparator's equal-tick
rule and a finite order book fighting each other — the branch that produces
better clears the book sooner, idles longer, and pays more rent for the
privilege, so it wins OTD and cycle time and loses net. That is an artifact
of the book, not a finding about capacity, and it makes fork comparison less
useful than it should be. See 6H.3 for the mechanism and for why demand has
to arrive from the **seed** rather than from the agent.

**The remaining sim units wait behind the agent.** 6G.2, 6G.3, 6H.2,
6H.3 are **deferred** (user call, 2026-09-04). The sim is done: it
has a five-line P&L, a book with a horizon, forking, and an API an agent can
already drive. What is left there is polish and perf, and playing the sim kept
generating more of it — 6F, 6G and 6H were all invented while driving 6E. Pick
them up after the agent, if its behaviour shows they are needed.

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

      **Promoted from "polish" to the thing blocking useful experiments**
      (user call, 2026-09-08, from running phase-3 experiments). 6H's original
      note blamed the order book; this is the mechanism. **A finite book
      penalises efficiency at a fixed horizon.** The comparator *enforces*
      equal `tickNum` — the right fairness rule for isolating a decision — so
      the higher-capacity branch, which clears the book sooner, spends a
      larger share of its equal-length window **idle**. Both branches then
      accrue rent and wages against time with no throughput left to earn, and
      the efficient one accrues *more*, because it is paying for the extra
      machine and the extra operator. The playthrough baseline prices the
      tail: an idle day costs **$4,051** on one press and more on two. So
      capacity pays back only until demand runs out and is pure cost
      afterwards — the branch that produced better keeps OTD and cycle time
      and **loses on net**. That is an artifact of the book's finiteness, not
      a finding about capacity, which is what makes fork comparison less
      useful than it should be right now.

      **Demand must come from the seed, not from the agent.** Tempting to let
      the agent create sales orders and derive work orders from them, and it
      breaks two things at once. Two same-seed branches would diverge because
      the model invented different orders — measuring the dice rather than the
      decision, the exact failure the draw-key design exists to prevent. And
      demand is read **live** by every run (`loadRunState`), so orders created
      mid-experiment change what every *other* run can still earn, including
      the control. The agent's decisions belong **on top** of arrivals rather
      than being the arrivals: accept or decline an order, promise a due date,
      price it, choose what to release. That is a richer decision surface than
      the static book and still replays from `rng_seed` alone.

      **Cheaper half-measure, if the full unit waits:** compare at *book
      exhaustion* rather than at a fixed tick — net at the moment the last
      order shipped, plus how long each branch took to get there. It asks a
      different question ("who cleared the book better") and needs the
      comparator's equal-tick rule relaxed for that one case, so it is not
      free, but it removes the idle tail from the verdict without any new
      simulation.

### Track 7 follow-ups — richer comparison (deferred)

Noted 2026-09-04, to pick up later (after the agent, unless it needs them):

- [ ] **Comparison functionality and display in the Dashboard and Trends.** The
      dashboard is still deliberately one run's window; revisit what a compared
      pair should show there, and how the Trends overlay presents beyond the
      single net curve.
- [ ] **More compare series on Trends** — e.g. an operating-expense line for
      the compared run, so the cost side of a decision reads alongside its net.

### Release policies (`feat/release-policy`) — complete

Planned 2026-09-04 from playing the sim: with only manual releases, a long
fast-forward drains the floor and rent burns on an idle factory. Three
policies plus manual, defaults in Factory Settings, frozen per run,
changeable per run under the lock — so forks can test policies against each
other. Priority is earliest-due-date, undated last, id tie-break.

- [x] RP.1 Schema + migration — five policy columns on `factory_settings` and
      `simulation_runs`; frozen at create; forkRun copies them
- [x] RP.2 Pure policy engine + tests — `planReleases` (conwip / due_date /
      dbr), `buildReleaseParts` shared with manual release, `admitOrderIntoState`
- [x] RP.3 Advance integration — evaluate per batch, release rows ride the
      batch transaction, `AdvanceResult.autoReleased` + `backlogCount`
- [x] RP.4 `POST /api/runs/:id/policy` + settings PATCH + `npm run check:policy`
- [x] RP.5 UI — settings fields, transport-bar Policy dialog, jump guard and
      drain-stop learn about backlog
- [x] RP.6 Ledger + doc sweep

### Track 8 — the agent (`feat/agent`), phases 1–2 complete

Architecture (user calls, 2026-09-07): a separate **Python FastAPI + LangGraph**
service (`agent/`), OpenAI models (`OPENAI_MODEL` in `agent/.env`), LangSmith
for tracing/evals; the frontend calls it directly on :8000, and its entire
tool surface is the backend's REST API. The end state is a supervisor with
specialists (read-only analyst, experiment runner, deterministic comparator,
verdict writer); phase 1 builds the foundation.

- [x] 8.1 Scaffolding — uv + FastAPI (`/health` pings the backend), CORS for
      :5173, three-terminal dev setup documented
- [x] 8.2 Read-only analyst — httpx sim client, read-only tools (runs, P&L,
      metrics, floor, capital log, order book, settings), single LangGraph
      agent, `POST /chat` streaming SSE events (token / tool / done / error)
- [x] 8.3 Chat UI — `/agent` page with a streaming chat window, tool-call
      chips, per-conversation thread memory
- [x] 8.4 Ledger + doc sweep
- [x] 8.5 Basic LangSmith evals — `uv run python -m factory_agent.evals.run`:
      a 7-question suite whose ground truth is computed from the sim at eval
      time (best run by net, constraint by whole-run utilization, order-book
      totals, a read-only refusal check), one pure `correctness` evaluator
      dispatching per-example checks, dataset rebuilt per invocation under one
      stable name so experiments accumulate against fresh truth

**First eval run (2026-09-07): 5/7 → 7/7** after 8.6 and 8.7.

- [x] 8.6 Tool errors return to the model instead of killing the turn — a
      shared `ANALYST_TOOL_NODE` with `handle_tool_errors=tool_error_message`,
      because langgraph 1.x's default handler **re-raises** anything that is
      not an argument-validation error, so a `SimApiError` escaped the graph
      and the "buy a machine" trap died on a 404 rather than declining. The
      handler is narrow *by annotation* (`SimApiError | ToolException` — the
      tool node infers the caught types from the signature), so our own bugs
      still crash rather than being laundered into the transcript as facts
      about the factory. The node is shared with the eval suite deliberately:
      evals that see different error behaviour measure a different agent.
- [x] 8.7 The constraint answer names the centre, not its id — a prompt rule
      that metrics carry ids only and the name must be resolved through the
      floor ("Drill Press (work center 98)").

**Phase 2 — the agent can act** (`feat/agent-actions`, 2026-09-07). User
calls taken before building: full write authority over any run, but a
human-in-the-loop confirmation naming the run's id and name before anything
is touched; the confirmation is a **structural pause**, not a prompt rule;
and the graph is hand-authored now while the analyst/actor **role split
waits** — the interrupt already supplies the authority boundary the split
would have provided, and the boundaries that pay are deterministic-vs-model
(the comparator), not analyst-vs-actor.

- [x] 8.8 Write tools — `actions.py` beside the read-only `tools.py`,
      `sim_client.post_json`, `ACTION_TOOL_NAMES` derived from the list so a
      new verb is gated by construction
- [x] 8.9 The graph and the gate — `agent → approval → tools`, reads routed
      past it, `interrupt()` + `Command(resume=…)`, `POST /chat/resume`, the
      approval payload built from the sim; `durability="sync"` and a
      per-thread lock, both settled by reading the langgraph source
- [x] 8.10 UI — approval cards in the transcript, decline resumes too, plus
      the styling pass the page needed (it had no page padding at all)
- [x] 8.11 Evals + doc sweep — the read-only trap becomes a pause check
      scoring conduct rather than prose, the runner prints its score

**Phase 3 — the verdict, and one approval per experiment — is complete**
(2026-09-08). Planned the same day from driving the phase-2 agent.
Two findings drove it. The verdict was being written *by the model* from
numbers it retyped, when both runs' P&L is frozen columns and the delta is
arithmetic. And a two-branch experiment cost **~44 approvals**, 43 of them
"yes, keep going": the backend caps an advance at 20,000 ticks while a
staffed day is 28,800, so 15 days is 22 calls a branch. The cap is about
synchronous request time, not authority, and it was spending human attention.

User calls taken before building:

- **The verdict displays as a card *and* prose** — the table is the fact, the
  paragraph is the interpretation, which is exactly the deterministic/model
  split this phase exists to draw. Shown on the model's own determination or
  on request, not on every read.
- **Charts are not rebuilt in the transcript.** The Trends overlay already
  draws two nets on one clock with the fork seam marked; the card deep-links
  it rather than shipping a worse copy in a chat bubble.
- **Authority is budgeted per experiment, not per call.** The model proposes
  the experiment — which runs, which verbs, how far to advance, how much it
  may spend — a human approves *that*, once, and the graph executes inside
  those bounds while streaming every step with a Stop. Anything outside the
  budget re-pauses. The boundary stays structural: a write still cannot run
  unless a human authorized it. What changes is the unit of authorization.
  Rejected: per-verb tiers (static — cannot tell an hour from 200 days, and
  caps no total spend) and show-and-go (removes the boundary 8.9 built, and
  neither `advance` nor a capital charge has an undo).

- [x] **8.12 The comparator** — `comparator.py`: pure over two runs'
      summaries and `/metrics`, returning the winner, the five P&L lines each
      signed against the score (they sum to the net delta by construction),
      the biggest mover, and the outcomes behind it including each side's
      constraint by id. Enforces what the prompt only asked for: an unequal-
      `tickNum` pair is refused, and a lineage pair windows from the fork
      seam. Verified live on the drill-press fork pair — +$4,487.75 net for
      $1,488 of capital, and **the constraint moved** (98 at 97.6% → 95 at
      100%), which is the sentence a capacity verdict wants.
- [x] **8.13 Structured tool output reaches the UI** — the SSE `tool` event
      carried a tool's name and arguments but never its *result*, so a
      computed answer could only reach the screen as prose the model retyped.
      A `result` event now carries the payload, opt-in per tool
      (`RENDERED_TOOL_NAMES`, derived from the tool list) because nothing
      renders a run's observation series; non-JSON content is skipped, so a
      failed call and a gate refusal stay the model's to explain.
      `verdict.ts` mirrors the comparator's shape and narrows it, returning
      null on skew rather than half-drawing. The transcript shows the
      comparator's own one-line verdict; the table is next. Verified live: the
      model called the comparator instead of subtracting, resolved both
      constraints to names off `/floor`, and one `result` event crossed the
      wire.
      **Deviation from the plan:** no `progress` event yet — it moves to 8.15
      with the emitter that needs it, since a vocabulary member with nothing
      to send is a boundary invented ahead of its caller.
- [x] **8.14 The verdict card** — `VerdictCard` draws the P&L delta as the
      table it is: diverging bars scaled against the biggest mover, the net
      row summing the column above it, the outcomes grid (finished, OTD,
      cycle, WIP, scrap) and a constraint line that says when the constraint
      **moved**. Pure transforms in `agent/verdictDisplay.ts`, 32 tests.
      Browser pass caught what the unit tests did not: cycle-time *deltas*
      rendered as raw seconds, because `formatDurationSeconds` assumes a
      duration and its two-minute bound catches every negative.
      **Split from the plan:** "Open on Trends" is its own unit (8.14b) — the
      compare state has to become URL-addressable first, which is
      `SimulationPage` work and independently useful, since it also makes a
      comparison shareable.
- [x] **8.14b Open on Trends** — `?run=&compare=` as URL state, built and
      parsed by the pure `simulation/runLink.ts`; the page seeds from the URL
      on open, opens Trends when a compare is present, validates ids against
      the loaded list (a shared link outlives a deleted run, so it toasts and
      falls back rather than 404ing), and writes back with `replace`. The
      verdict card links the pair it judged, variant primary. Browser-verified
      both ways: the link lands on the overlaid curves with the fork seam, and
      `?run=999` fell back to the newest run and rewrote its own URL.

- [x] **8.14c Render the agent's markdown** — `react-markdown` +
      `remark-gfm` behind a component map, so styling stays on semantic
      tokens and every heading flattens to one weight. Chose the dependency
      over a subset renderer because the alternative is a parser, not a
      formatter, and because react-markdown yields React elements — no
      `dangerouslySetInnerHTML` in the path. `rehype-raw` deliberately
      absent: model output is untrusted text, so raw HTML is escaped, and
      there is a test for it. 9 tests via `renderToStaticMarkup` (no DOM
      needed), and browser-verified — bold, bullets, italics and a real
      table.
- [x] **8.15 `advance_to_tick`** — one approval for a jump of many requests
      (44 → 1 for a 15-day branch), taking an **absolute target** so two
      branches land on the same tick by construction. `control.py` carries
      the transport: `progress` on `stream_mode="custom"`, and a stop that
      stops *dispatching* at a committed boundary rather than aborting in
      flight, one-shot and cleared per turn. The chat page now owns its
      thread id from the first turn — it used to arrive on `done`, too late
      to stop a tool running inside that same turn. Two things the langgraph
      source settled: `get_stream_writer` raises **KeyError** (not
      RuntimeError) inside a bare `tool.ainvoke()`, so best-effort progress
      has to catch both or it works in production and fails in its own tests;
      and `custom` is the only stream mode that surfaces a tool's writes.
      **Not yet browser-verified** — the backend was down when this was
      finished, and a live pass means advancing a real run, which is
      irreversible; worth doing on a throwaway run before trusting the Stop
      button.
- [x] **8.16 Budgeted plan approval** — `propose_experiment` +
      `budget.py`: the model asks for a whole experiment, a person approves
      the **bounds** (runs, verbs, tick horizon, spend ceiling), and covered
      writes then run without stopping. A grant can only *skip a pause it
      covers*, so a wrong or stale one costs an extra question rather than an
      unapproved write; the ceiling is checked against the sim's frozen quote,
      never the model's number; spend counts at authorisation, because
      over-counting costs a question while reconciling against the capital log
      cannot separate this experiment's spend from what a fork inherited. A
      grant lives in the checkpointed state, so it outlives its turn and dies
      with the conversation. 37 tests, 11 of them through the real graph on
      the authority properties themselves.
      **Split from the plan:** the plan **card** is 8.16b. This ships the
      mechanism with the existing card rendering it (the summary states the
      bounds, `outsidePlan` explains a pause that happened anyway), which
      works but does not yet show a grant's remaining ceiling or let anyone
      revoke one.
- [x] **8.16b The plan card, and revoking a grant** — the half that makes a
      standing grant defensible. A `plan` SSE event is pushed whenever the
      grant changes (approval, and each charge against the ceiling, so the
      banner's remaining figure is live), `POST /chat/revoke` clears it by
      writing the graph state directly rather than asking the model to stop
      using its budget, and the page keeps the grant on screen with its four
      bounds and what is left. The approval card lays those bounds out as
      four rows, since each pauses on its own. 16 tests.
      **Still not browser-verified** — the backend has been down for both this
      and 8.15; one pass covers both, and it needs a throwaway run since a
      live plan lets the agent act.
- [x] **8.17 Evals + doc sweep** — the comparator is ground truth an eval can
      score a verdict against with no rubric, and three examples now score
      **conduct**: that the graph stopped on the right call, that a multi-step
      request pauses on `propose_experiment` rather than the first write, and
      that "which line moved" is answered by *calling* the comparator rather
      than subtracting two summaries by hand (`used_tool` reads the turn's
      real tool calls). The verdict example needs a pair at the same tick,
      since the comparator refuses anything else; with no such pair the
      comparison examples are absent **and the runner says so**, because a
      smaller suite still scoring 100% is the quiet regression an eval exists
      to catch.

Known limits, deliberately carried rather than fixed: `InMemorySaver` drops
pending approvals **and granted plans** on restart and forbids a second
uvicorn worker — it was tolerable when a lost pause cost one click, and a
lost *grant* is a bigger thing to drop, so this is the first candidate if
phase 4 goes further; there is no free-text note on a decline in the UI,
though the API takes one; and the chunked advance and the plan banner have
**not had a hands-on browser pass** (the backend was down through both), which
wants a throwaway run, since an approved plan is permission for the agent to
act and advancing cannot be undone.

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

### Track 7 — Run forking (`feat/run-forking`)
- [x] 7.1 `forkRun` — every `run_*` table copied under the parent's lock, one transaction; `npm run check:fork` is the replay-identity proof
- [x] 7.2 `POST /api/runs/:id/fork` — optional name, 201 with the run row; copy-vs-replay resolved as **copy**
- [x] 7.3 Fork in the UI — button beside New Run, lands on the child; lineage in the picker and run bar
- [x] 7.4 Compare on net profit — dashed compare-net on Trends at one shared bucket, fork-seam line; `mergeCompareNet` pure + tested
- [x] 7.5 Ledger + doc sweep
