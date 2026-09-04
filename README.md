# 🏭 Factory Flow

Factory Flow is a manufacturing simulation platform focused on modeling production systems and exploring how factories can optimize for their true objective: making money.

Inspired by Eliyahu M. Goldratt's _The Goal_, this project models production flow, throughput, work-in-process (WIP), inventory, and operational constraints to better understand how local decisions affect overall system performance.

Rather than optimizing individual machines, Factory Flow aims to simulate an entire manufacturing system where bottlenecks, variability, and flow determine overall profitability.

---

## Objectives

- Simulate the movement of work through a manufacturing facility.
- Model the relationship between throughput, inventory (WIP), and operational expense.
- Explore how bottlenecks limit system performance.
- Visualize the effects of statistical fluctuations and dependent events on production flow.
- Experiment with scheduling strategies, routing, staffing, and process improvements.
- Run the factory as a business: revenue, operating expense, and capital spend, judged on net profit.
- Make the _consequences_ of a decision measurable: run it, fork it, compare it.

---

## Where the project is today

**Master data (Postgres + Drizzle)**

- Parts, work centers, routings with ordered routing steps, work orders, sales orders, allocations.
- Referential rules are deliberate: routing steps `RESTRICT` their work center (a referenced centre can't be deleted), while sales/work order deletes cascade their allocations behind a confirmation step.

**Order entry (`/orders`)**

- Sales orders and work orders: list, create, delete (with cascade confirmation).
- Allocations link work orders to sales orders, which is what makes finished units worth money.

**Factory setup (`/setup`)**

- Work centers: create, rename, delete.
- Parts: create, edit, delete (with a split confirmation model — a part referenced by an order can't be deleted at all, while one referenced only by routings can be force-deleted).
- Routing editor is next.

**Simulation (`/`)**

- Pure-function tick engine, unit-tested with vitest, in `backend/src/simulation/`. There is exactly one copy of it: the frontend's was deleted when the page switched to driving a server-side run.
- One tick = one simulated second. A run is advanced by `POST /api/runs/:id/advance {ticks}` — the page calls it once a second to watch in real time, and a caller wanting 5000 ticks asks for them and gets them in about ten seconds.
- A work center runs up to its `capacity` in parallel (1 by default); parts already in service claim their centre first, idle parts take what's left. Queueing is implicit — unclaimed parts simply don't advance.
- Process times are sampled per step as uniform ±30% around the routing's nominal time. The statistical variation is the model, not noise.
- **A run can be fast-forwarded.** Jump 100, 500 or 1000 ticks, or run until the floor is empty (with a ceiling, for a floor that can never empty). A jump advances in chunks of 500 — one server transaction each — so stopping one ends on a committed tick rather than mid-batch, and it terminates on the WIP the advance itself reports rather than on a follow-up read that could already be stale.
- Each tick reports what the floor did — machines busy and parts queued per work centre, and WIP on hand — which reduces over a window to utilization, mean and worst queue depth, and mean and peak WIP. Finished parts carry the tick they were released on, so cycle time measures queueing as well as processing, with a median and a 95th percentile alongside the mean. Stored per tick and readable over `GET /api/runs/:id/metrics?fromTick&toTick`, and drawn by the Dashboard tab: stat cards over a work-centre table ranked by utilization, the constraint on top, with window controls (whole run, last-N, custom range) — a jump lands the dashboard on the jump's own ticks. The window matters: one bottleneck read 10% utilization over a whole run and 52% over the ticks it was actually working, which is why the dashboard labels every figure with the window the response covered.
- **Throughput is measured in cents, not parts**: a finished unit earns `unit price − material cost` only if an allocation covers it. Finish order decides which sales order (and which price) a unit is credited to.
- Live throughput charts: the run's stored per-tick money accumulated into the cumulative curve, the same money as a trailing rate in $ per simulated minute (the successor to the old trailing-mean smoothing), and WIP over time as a step line. The series is capped at the newest 5000 ticks, so the cumulative curve carries on from what the run had already earned rather than re-basing at zero — exactly, because per-tick money and the run's frozen per-part money are two sums of the same credits — and the rate divides its first window by the ticks it can actually see rather than drawing a ramp out of the cap.

**The limitation that shaped this roadmap is closed.** A run is a server-side object with an id: its parts, its per-tick observations, its finished units and the money each earned all persist, so a page refresh resumes the run where it was and results outlive the tab. Advancing writes once per batch of 500 ticks inside one transaction, so **a crash loses at most one batch** and never leaves a run half-written.

A run also freezes the factory it was created with — each released work order pins the routing steps it will follow, and capacities are copied per run — so editing a routing or a machine count changes only runs created afterwards, and never re-plans a part already in motion. Randomness is a pure function of `(seed, work order, unit, step)`, so a run is reproducible from its seed alone: two runs created with the same seed and the same releases are identical, which is what lets two policies be compared on the decision rather than on the dice.

**Still ephemeral:** which orders exist and what they pay is read live, not frozen per run. Completed history is safe — the money each finished unit earned is frozen as it is credited — but editing the order book mid-run changes what later units are worth.

---

## Roadmap

The theme: go from _"a simulation that runs"_ to _"a system of record for simulated factories that you can experiment against and reason about."_

### Phase 1 — Persistent factory state — **delivered**

The simulation stopped living only in React state.

- Persist WIP, work centre occupancy, queues, and part progress to the database.
- A **simulation run** is a first-class record: created, named, resumable, deletable.
- Reopening the app resumes a run where it left off instead of restarting from zero.
- Multiple runs coexist against the same master data.

### Phase 2 — Real time, not just ticks — *partly delivered*

The server owns advancing, so the physics no longer depend on a browser being open: a run is advanced in batches by request, and asking for 5000 ticks takes about ten seconds. The page can now jump a run forward — 100, 500 or 1000 ticks, or until the floor is empty — chunked so that stopping a jump always lands on a committed tick, and a jump lands on a labelled window of metrics. What is missing is that **nothing advances a run unattended** — no clock and no calendar.

- ~~Move from "one tick = one interval callback" to a clock the run owns.~~ Partly: the loop is the server's and runs in batches, but it is still a request that drives it, not time passing.
- **Speed control — one honest speed, no multipliers.** The live clock plays one simulated minute per real second (60 ticks a beat — far inside what the server sustains), and fast-forward jumps in calendar units (+1 hour / +4 hours / +1 day) that stream in chunk by chunk. An unbounded "100×" multiplier stays unbuilt: it starts lying the moment it outruns the server. Run until idle was removed with the cost model — an idle factory burns money, so running a floor empty stopped being a question worth a button.
- A run continues advancing correctly whether or not anyone is watching it — the tick loop shouldn't be a UI concern. **Still open**, and deliberately deferred: a background loop would be the first stateful thing in the server process, and an agent driving the run wants determinism rather than something ticking underneath it.
- ~~A calendar on top of the clock: shifts~~ (6D: a day is `shifts × 28,800` staffed ticks, frozen per run), working days and idle hours still unmodelled — off-shift time simply isn't ticks.

### Phase 3 — Event history and snapshots — *partly delivered*

The record of _what happened_, which everything downstream reads from. The time series exists — a row per tick with WIP, throughput and per-work-centre occupancy and queue depth, aggregating to utilization and cycle time over any window. The **event log does not**, and it is the half Phase 7 explains and Phase 8 predicts on.

- **Production event history**: an append-only log of every meaningful event — job released, step started, step finished, part blocked/queued, work centre idled, order completed, order shipped, downtime started, money spent or earned.
- **Factory snapshots**: periodic state captures with time-series metrics attached — WIP by work centre, queue lengths, utilisation, throughput (cents), operating expense to date, cash position, cycle time, on-time performance.
- Snapshots are the checkpoints Phase 5 forks from; the event log is what Phase 7 explains and Phase 8 predicts on. Note that forking needs less than was assumed here: a run is reproducible from its seed, so a fork can copy a few rows rather than replay a log.

### Phase 4 — Operating expense and the P&L — *partly delivered*

~~Right now the factory can only make money.~~ It can lose it now: Track 6A
delivered the cost triple — per-work-centre standing cost, facility overhead,
and a carrying charge on the material value sitting on the floor — accruing
per tick against the run's frozen rates, with `netCents` (throughput − operating
expense − carrying) as the score on the run summary and over any window. A
calendar day is `shifts × 28,800` one-second ticks (one 8-hour shift today);
rates are entered per 24h day and amortized over the day's staffed ticks.
Track 6B added due dates and on-time delivery (a metric, deliberately not yet
money). Track 6C delivered setup and scrap: a changeover is machine time paid
once per work order per step (so batch size finally trades off against
carrying cost, and a split order costs the constraint a second setup), and
scrap is a per-step probability drawn at step completion through the seeded
RNG in its own domain — a ruined unit's material is recorded but not charged,
its money bite being the lost sale, the wasted machine time and the carrying
already paid. Track 6D added shifts and wages: a run's calendar day is
`shifts × 28,800` staffed ticks, and operators are
paid per staffed hour — so a second shift doubles the day's wage bill while
amortizing the same rent. Track 6E added **capital actions**: buy or retire a
machine, hire or let go an operator, against the run's *own* frozen config
while it runs. Operators became explicit, so a centre runs
`min(machines, operators)` and a machine nobody staffs is rent with no output;
each action charges a lump at the tick it lands, frozen on an append-only row,
and net profit now subtracts a fifth line. Still
open from the list below: overtime and mid-run shift changes (Track 6F — a
non-uniform calendar day, and a premium without which overtime dominates
every other labour lever), rework, and the penalty halves of 6B's
and 6C's bullets — see PROGRESS.md for the sub-track plan.

The model already tracks Throughput in cents (revenue minus material cost, credited only against an allocation). This phase completes Goldratt's triple by adding **Operating Expense** and putting a price on **Inventory** — so the objective function becomes _net profit_, not parts finished and not throughput alone.

**Cost accrues against simulated time, not against production.** That's the whole point: an idle work centre still burns money, so keeping a non-bottleneck busy to "look efficient" produces nothing but expensive WIP.

- **Recurring operating expense**
  - Facility overhead per simulated day — rent, utilities, the cost of the doors being open.
  - Per-work-centre standing cost — depreciation, maintenance, power, tooling.
  - ~~Operator wages per shift-hour~~ (6D), with an overtime rate still open — an authorization, deferred to the capital actions.
- **Variable cost**
  - Material cost per part (already modelled).
  - ~~Setup cost per changeover, which finally makes batch-size decisions have a real trade-off.~~ Delivered as machine time (6C), not a cents charge — the cost is rent against time and lost constraint minutes.
  - ~~Scrap~~ (6C) and rework cost — rework still open, and scrapped material is recorded, not yet charged.
- **Inventory carrying cost** — a holding charge on WIP and finished goods per unit per day, so sitting inventory is genuinely expensive rather than just a number on a chart. This is what makes "release less work" a financially visible strategy.
- ~~**Capital decisions**~~ — delivered as Track 6E, actions that cost money up front and change the factory afterwards:
  - ~~Buy a machine~~: a one-off outlay, then another machine's standing cost at that centre — standing cost is now **per machine**, so buying prices its own keep. Delivered as capacity at an *existing* centre rather than a new one: a new centre nothing routes to would need routings changed mid-run.
  - ~~Hire an operator~~: an onboarding cost, then a recurring wage. Letting one go is deliberately **free** — a crew you can shed cheaply is the temp lever, and it is what gives a shift's commitment something to beat.
  - Add a shift, or authorise overtime for a period — **still open** (Track 6F). Both make a run's calendar day non-uniform, which is the one place `day_ticks` is a single frozen integer, and overtime needs a wage premium or it strictly dominates hiring.
  - ~~Sell or retire a machine~~: returns salvage, which is less than the purchase price, so churning one costs real money.
- **Penalties** — ~~due dates~~ delivered as Track 6B: sales orders carry a due day, runs freeze each finished unit's due tick, and the dashboard reads on-time delivery overall and per order. Deliberately a metric and not money — no late penalty on the P&L yet; the frozen per-part due tick is any future penalty's basis. Lost sales still to come.

**What this produces**

- A **run P&L**: throughput, operating expense, carrying cost, wages, capital spend, net profit — over the whole run and over any selected time window. *Delivered in full: `GET /api/runs/:id` and `/metrics` both carry all five lines, summed from frozen columns so no later edit can rewrite what a run spent.*
- A **cash curve** alongside the throughput chart, so it's visible when the factory is running at a loss even while output looks healthy. *Delivered: cumulative net profit overlaid on the cumulative-throughput chart, with a zero line.*
- **Payback period** on capital decisions: buy the second machine at the bottleneck, and see how many simulated days until it pays for itself. *Readable rather than reported: capital is charged as a lump, so the cumulative net curve steps down by the purchase and payback is where it climbs back over what doing nothing would have earned. A number needs Track 7's two runs side by side.*
- A break-even question worth asking every run: at this demand and this cost structure, is this factory profitable at all?

### Phase 5 — Forkable simulations

The core experiment loop, and the most valuable feature in the project.

- Fork a run from any checkpoint: same state, new branch, new decisions.
- Make a different call on the fork — change priority, add capacity, re-route, split a batch, expedite an order, buy a machine, add a shift — and let it play out. *Two of those are already real: a run can buy machines and hire operators through Track 6E's actions, and a run can be created with a different shift count. What forking adds is doing it from a checkpoint of a run already in motion, against a sibling that didn't.*
- Runs form a tree, so a chain of decisions can be traced back to the checkpoint it diverged at.
- **Compare forks side by side**: same time window, same metrics, difference highlighted.
- **The comparison is scored on net profit, not throughput.** With Phase 4 in place, a fork that raises output but required a machine purchase and a second shift can lose to the fork that did nothing. That result is only visible if cost is in the model — which is why the money model comes first.
- Every comparison has to be measurable — deltas in net profit, throughput, operating expense, WIP, cycle time, lateness — not just a visual impression.

### Phase 6 — Interface for experimentation

Card-based factory visuals don't scale to five forks running at once.

- **Table view of the factory** as the primary layout for comparison work: one row per work centre, expandable to show queue contents, current job, progress, utilisation, cost accrued, and history.
- Dense by design — far more data per work centre than a card can hold.
- The current visual/spatial factory view stays available; the table is the default when comparing.
- **Metrics and charts scoped to a time period**, so a decision's effect can be read over the window it happened in rather than as one lifetime average.
- Multi-run comparison view: several runs on the same axes at once, with a P&L column per run.

### Phase 7 — Explanation and root-cause analysis

- **Root-cause reports**: given a bad outcome (an order shipped late, throughput dipped, WIP ballooned, the run lost money), walk the event log backwards and name the cause — which constraint, which queue, which decision, which cost.
- **AI explanations** of a run or a fork comparison in plain language: what happened, why the two branches diverged, which decision drove the delta and what it cost.
- **Autonomous explanation**: the system surfaces notable events on its own — "this work centre became the bottleneck at t=400", "carrying cost overtook throughput on day 6" — instead of waiting to be asked.
- Root-cause reporting is the higher-value half of this phase; it's grounded in the event log and doesn't depend on the AI being right about anything it can't cite.

### Phase 8 — Predictive model (traditional ML)

- Train a model on historical run data to predict **whether a job will be late**, and flag it while there's still time to act.
- Features come out of Phase 3: queue depth ahead of the job, remaining steps, bottleneck load, current WIP, historical variability at each work centre.
- With Phase 4 penalties in place, a lateness probability converts directly into expected cost — which makes it actionable rather than merely informative.
- Deliberately a conventional ML model, not an LLM — this is a calibrated-probability problem with real labels available from the event history.

### Phase 9 — AI agent

Built on top of everything above, not instead of it.

- Agent with tools over the simulation: start a run, advance it, fork at a checkpoint, apply a decision, read metrics and the P&L, compare runs, read the event log.
- The agent runs the experiment loop autonomously — try a policy, fork alternatives, measure, report which one won and why.
- **Recommendations for what to do next**, backed by fork results rather than by assertion, and priced: "buy the second drill press — it pays back in 11 days and adds $X/day net."
- **AI-generated scenarios**: plausible shop-floor disruptions injected into a run — machine breakdown, operator absence, rush order, material shortage, scrap/rework, a cost shock — for stress-testing a schedule.

### Phase 10 — Retrieval over historical knowledge (exploratory)

- RAG over accumulated run history plus written planner/operations notes, so past situations can inform present ones ("we've seen this pattern before, here's what happened").
- Lower confidence than the rest of the roadmap. Structured root-cause reports over the event log may cover most of the value with far less machinery — this stays exploratory until the earlier phases prove otherwise.

### Manufacturing model still to build

Independent of the phases above, the domain model needs:

- Bills of materials.
- Inventory management.
- Multiple production lines.
- Machine downtime and operator availability.
- ~~Due dates on orders~~ (landed with Track 6B — the remaining prerequisite work is the prediction itself).
- Explicit queues. Queue *depth* is now measured per tick, per work centre, so the aggregate dynamics are no longer inferred — but queueing is still implicit in the engine (an unclaimed part simply doesn't advance), so there is nothing to reorder, prioritise, or measure a wait time from.
- ~~Wage rates and per-work-centre cost rates as master data~~ (Tracks 6A/6D/6E: standing cost per machine, wages per operator-hour, and the capital prices all live on `work_centers` and freeze onto each run). **Shift calendars** remain: `shifts` is one facility number, so every day of a run is the same width — a real calendar (a short Friday, a dark week) is Track 6F's `run_days` table.

---

## Open questions

Decisions not yet made, recorded so they get made deliberately:

- Whether forking copies state or replays from a checkpoint. Leaning copy: a run's state is a handful of rows, and the seeded RNG means a copy replays identically without an event log to keep.
- ~~Whether a run should be able to edit its *own* factory config.~~ **Answered by Track 6E: yes, and only through an action that charges for it.** `run_work_centers` has exactly one writer — a capital action, which pays the run's frozen price, re-dates the rate it moved and appends to `run_capital_actions`. Free editing was never the question worth answering; a factory you can reconfigure for nothing makes every decision trivial. Pinned *steps* still have no writer, so changing what the next release will pin remains an edit to the shared routing.

Answered since, kept here because the answers shaped everything after them:

- **Where the tick loop lives** — the server, in batches. It loads a run once, advances N ticks in memory and writes once per 500; the browser's 1s interval is a display clock that asks for one tick, not the loop itself. Per-tick writes would have made a Neon round trip out of every simulated second.
- **Snapshot granularity** — per tick for observations (`run_ticks` plus a row per work centre), because WIP is mutable state and nothing else can say what it was at tick 300. WIP itself is replaced wholesale per batch, no snapshots.
- **Master data versioned per run, or runs pin a revision** — runs pin, and pin per *work order* at release rather than per run, so a routing edit reaches only later releases while parts already in motion keep the steps they started with.
- Whether cost rates are master data or per-run configuration — a fork that buys a machine changes the factory's cost structure, so at minimum the delta has to belong to the run and not to the shared master data.
- ~~Whether capital spend is amortised or charged as a lump at the moment of purchase.~~ **Answered by Track 6E: a lump**, and the argument is timescale rather than simplicity. A realistically amortised machine — $20k over a five-year life — is about $11/day against a ~$1,900/day factory, so inside the days a run spans the purchase would be free and "always buy" would be right every time: the degenerate objective Track 6A exists to prevent. Amortisation only bites here by inventing an unrealistically short machine life. It also stays layerable later, since the cents are frozen per action, exactly as 6B froze a due tick without a penalty.

---

## Current Production Flow

```text
Raw Material
      │
      ▼
 Cutter
      │
      ▼
 Drill Press
      │
      ▼
 Deburr
      │
      ▼
 Inspection
      │
      ▼
 Packaging
      │
      ▼
 Finished Goods
```

---

## Technology

- **Frontend** — React 19, TypeScript, Vite, Tailwind CSS v4, React Router, Recharts, Vitest
- **Backend** — Express 5, TypeScript, Drizzle ORM, Neon serverless Postgres, Zod

Two independent npm projects — no monorepo tooling. See `CLAUDE.md` for commands and conventions.

---

## Long-Term Vision

The long-term objective is to build a simulation capable of modeling realistic manufacturing environments where routing, constraints, statistical variation, and operational policies can be evaluated before changes are made on the shop floor.

Forking is what turns that from a demo into a tool: the same factory, the same moment, two different decisions, and a measured answer for which one made more money.

By combining production simulation with manufacturing principles, Factory Flow aims to provide insight into how improvements in flow—not simply machine utilization—affect overall factory performance.
