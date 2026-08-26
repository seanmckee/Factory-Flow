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

- Pure-function tick engine, unit-tested with vitest. It now lives in `backend/src/simulation/`; the page still drives an unchanged copy in `frontend/src/simulation/` until runs move server-side.
- One tick = one simulated second, driven by a 1s interval on the page.
- A work center runs up to its `capacity` in parallel (1 by default); parts already in service claim their centre first, idle parts take what's left. Queueing is implicit — unclaimed parts simply don't advance.
- Process times are sampled per step as uniform ±30% around the routing's nominal time. The statistical variation is the model, not noise.
- Each tick reports what the floor did — machines busy and parts queued per work centre, and WIP on hand — which reduces over a window to utilization, mean and worst queue depth, and mean and peak WIP. Engine-side so far; nothing displays it yet.
- **Throughput is measured in cents, not parts**: a finished unit earns `unit price − material cost` only if an allocation covers it. Finish order decides which sales order (and which price) a unit is credited to.
- Live throughput chart: per-tick throughput → last 120 ticks → 60-tick trailing mean → cumulative.

**Known limitation that shapes the roadmap:** the simulation is entirely ephemeral. Nothing about a run survives a page refresh — no state, no history, no results. Everything below starts from fixing that.

---

## Roadmap

The theme: go from _"a simulation that runs"_ to _"a system of record for simulated factories that you can experiment against and reason about."_

### Phase 1 — Persistent factory state

The simulation should stop living only in React state.

- Persist WIP, work centre occupancy, queues, and part progress to the database.
- A **simulation run** is a first-class record: created, named, resumable, deletable.
- Reopening the app resumes a run where it left off instead of restarting from zero.
- Multiple runs coexist against the same master data.

### Phase 2 — Real time, not just ticks

- Move from "one tick = one interval callback" to a clock the run owns: simulated time advances against wall-clock time.
- Speed control (pause, 1×, 10×, 100×, run-to-completion) without changing the physics.
- A run continues advancing correctly whether or not anyone is watching it — the tick loop shouldn't be a UI concern.
- A calendar on top of the clock: shifts, working days, and idle hours. Needed for Phase 4, because cost accrues against time whether or not anything is being produced.

### Phase 3 — Event history and snapshots

The record of _what happened_, which everything downstream reads from.

- **Production event history**: an append-only log of every meaningful event — job released, step started, step finished, part blocked/queued, work centre idled, order completed, order shipped, downtime started, money spent or earned.
- **Factory snapshots**: periodic state captures with time-series metrics attached — WIP by work centre, queue lengths, utilisation, throughput (cents), operating expense to date, cash position, cycle time, on-time performance.
- Snapshots are the checkpoints Phase 5 forks from; the event log is what Phase 7 explains and Phase 8 predicts on.

### Phase 4 — Operating expense and the P&L

Right now the factory can only make money. It needs to be able to lose it.

The model already tracks Throughput in cents (revenue minus material cost, credited only against an allocation). This phase completes Goldratt's triple by adding **Operating Expense** and putting a price on **Inventory** — so the objective function becomes _net profit_, not parts finished and not throughput alone.

**Cost accrues against simulated time, not against production.** That's the whole point: an idle work centre still burns money, so keeping a non-bottleneck busy to "look efficient" produces nothing but expensive WIP.

- **Recurring operating expense**
  - Facility overhead per simulated day — rent, utilities, the cost of the doors being open.
  - Per-work-centre standing cost — depreciation, maintenance, power, tooling.
  - Operator wages per shift-hour, with an overtime rate for hours beyond the shift.
- **Variable cost**
  - Material cost per part (already modelled).
  - Setup cost per changeover, which finally makes batch-size decisions have a real trade-off.
  - Scrap and rework cost.
- **Inventory carrying cost** — a holding charge on WIP and finished goods per unit per day, so sitting inventory is genuinely expensive rather than just a number on a chart. This is what makes "release less work" a financially visible strategy.
- **Capital decisions** — actions that cost money up front and change the factory afterwards:
  - Buy a machine: one-off capital outlay, then a new work centre with its own standing cost.
  - Hire an operator: onboarding cost, then a recurring wage.
  - Add a shift, or authorise overtime for a period.
  - Sell or retire a machine.
- **Penalties** — late-delivery penalties and lost sales, once orders carry due dates. Lateness stops being a metric and starts being a number on the P&L.

**What this produces**

- A **run P&L**: throughput, operating expense, carrying cost, capital spend, net profit — over the whole run and over any selected time window.
- A **cash curve** alongside the throughput chart, so it's visible when the factory is running at a loss even while output looks healthy.
- **Payback period** on capital decisions: buy the second machine at the bottleneck, and see how many simulated days until it pays for itself.
- A break-even question worth asking every run: at this demand and this cost structure, is this factory profitable at all?

### Phase 5 — Forkable simulations

The core experiment loop, and the most valuable feature in the project.

- Fork a run from any checkpoint: same state, new branch, new decisions.
- Make a different call on the fork — change priority, add capacity, re-route, split a batch, expedite an order, buy a machine, add a shift — and let it play out.
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
- Due dates on orders (a prerequisite for both lateness prediction and late penalties).
- Explicit queues, so queue dynamics can be measured rather than inferred.
- Shift calendars, wage rates, and per-work-centre cost rates as master data.

---

## Open questions

Decisions not yet made, recorded so they get made deliberately:

- Where the tick loop lives once runs are persistent — client, server, or a worker.
- Whether forking copies state or replays the event log from a checkpoint.
- Snapshot granularity: every tick, every N ticks, or on state change.
- Whether master data is versioned per run, or runs pin a revision of it.
- Whether cost rates are master data or per-run configuration — a fork that buys a machine changes the factory's cost structure, so at minimum the delta has to belong to the run and not to the shared master data.
- Whether capital spend is amortised or charged as a lump at the moment of purchase. Lump is simpler and makes payback period obvious; amortised makes the daily P&L less lumpy.

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
