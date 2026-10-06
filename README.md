# 🏭 Factory Flow

[![CI](https://github.com/seanmckee/Factory-Flow/actions/workflows/ci.yml/badge.svg)](https://github.com/seanmckee/Factory-Flow/actions/workflows/ci.yml)

**A manufacturing simulator where the score is net profit, not parts finished,
with an AI agent that runs experiments on the factory and asks a human before
it changes anything.**

Model a shop floor, run it forward through simulated days, fork the run at any
moment, take one decision in one branch, then measure what that decision was
worth. Or ask the agent to do it:

![The agent running a full experiment: it reads the run, proposes a bounded plan, forks, buys a machine, advances both branches with live progress, and returns a computed verdict](docs/screenshots/agent-experiment.gif)

> *"Run #78 is at Day 4 · 0:00. Is a second machine at its constraint worth
> buying?"* The agent finds the constraint and proposes an experiment. Once a
> person approves it, the agent forks the run, buys the machine, hires an
> operator and advances both branches to the same tick, showing progress as
> it goes. It answers with a verdict **computed by code, not written by the
> model**. (Recorded in real time, sped up.) [The full walkthrough
> ↓](#the-agent)

It's a study of Eliyahu Goldratt's _The Goal_, built as software: throughput is
money made through sales, inventory is money tied up on the floor, and operating
expense is money burned turning one into the other. Optimising a machine is
easy. Optimising the system is the whole problem, and it's only visible once
running a machine costs money whether or not it produces anything.

**Stack** — React 19 · TypeScript · Vite · Tailwind v4 · Recharts ·
Express 5 · Drizzle ORM · Neon serverless Postgres · Zod · Vitest ·
Python 3.12 · FastAPI · LangGraph · OpenAI · LangSmith

**Status:** the simulator works end to end. The AI agent reads it, runs
experiments on it, and changes it through the same REST API the browser uses.
Every change goes through a human approval gate. There are 519 unit tests,
and none of them touch a database, an HTTP server or a live model.

## Contents

| | |
| --- | --- |
| **[The question it exists to answer](#the-question-it-exists-to-answer)** | Fork a run, make one decision, read what it was worth |
| **[The agent](#the-agent)** | An AI operator over the simulation |
| ↳ [Ask it about the factory](#ask-it-about-the-factory) | Read-only analysis; it names the figures it relied on |
| ↳ [Ask it to test a decision](#ask-it-to-test-a-decision) | One approval covers a whole experiment, within four limits |
| ↳ [The verdict is computed, not written](#the-verdict-is-computed-not-written) | A deterministic comparator decides which branch won |
| ↳ [Every write stops at a gate](#every-write-stops-at-a-gate) | Approval cards built from what the sim reports, not from the model's claims |
| ↳ [How the authority boundary is built](#how-the-authority-boundary-is-built) | Enforced by the code's structure, not by the prompt |
| ↳ [Evals scored against the sim](#evals-scored-against-the-sim-not-against-a-judge) | Ground truth computed from the simulation, not judged by another LLM |
| **[The tour](#the-tour)** | The simulator UI |
| ↳ [The floor](#the-floor--what-is-happening-right-now) | Live status of every work centre |
| ↳ [The dashboard](#the-dashboard--a-pl-over-any-window) | A profit-and-loss view over any time window, with the constraint ranked first |
| ↳ [Capital actions](#capital-actions--decisions-that-cost-money-up-front) | Buy or retire machines, hire or let go operators, at prices frozen when the run started |
| ↳ [Release policies](#release-policies--how-work-reaches-the-floor) | CONWIP, due-date, drum-buffer-rope |
| ↳ [The factory is data](#the-factory-is-data) | Routings with setup time and scrap, plus orders and allocations |
| **[How it works](#how-it-works)** | Engine, determinism, frozen config, persistence, API |
| **[Running it](#running-it)** | Three services, one command each |
| **[Deliberately not built](#deliberately-not-built)** · **[What's next](#whats-next)** | Scope, stated plainly |

---

## The question it exists to answer

The drill press is the constraint. A second one costs $1,200, plus $288 to hire
somebody to stand at it, plus $300/day of rent and $144/day of wages forever
after. Is it worth it?

You can't answer that from a utilization chart. You answer it by running the
factory twice from the same moment, with the same dice, and reading the money.

![Two runs on one clock — the compared run's net curve overlaid, dashed, with the fork seam marked](docs/screenshots/trends-compare.png)

Run **#58** kept one press. Run **#59** was forked from it at the start of day 4,
bought a second press and hired an operator, and ran on. Same seed, same order
book, same release policy — the branches are byte-identical up to the dashed
`fork` line and diverge only because of the decision.

By day 9:

|                  | #58 Baseline | #59 Second press |
| ---------------- | -----------: | ---------------: |
| Throughput       |  $45,162.00 |       $53,246.00 |
| Capital spent    |       $0.00 |        $1,488.00 |
| **Net profit**   | **$15,505.25** |   **$19,993.00** |
| Parts finished   |        1,010 |            1,376 |

The $1,488 decision was worth **$4,487.75** in five simulated days. That number
is the product — not the chart, not the utilization figure. Everything in the
codebase exists so that number can be trusted: same seed, same draws, frozen
prices, money summed from columns written when it was earned.

---

## The agent

`agent/` is a third service, a Python FastAPI app hosting a hand-built
LangGraph agent. It does more than answer questions about the factory. It
**runs experiments on it**: it forks a run, makes a decision in one branch,
advances both branches and measures the difference. A human grants the
authority for that, once per experiment, within limits the code enforces.

It is a **pure HTTP client of the backend**. It has no database connection and
does not import the engine. Its whole tool surface is the same REST API the
browser uses, so it follows the same run locks, frozen config and seed
reproducibility as any other client. There is no back door into the engine,
which is why the API was built first.

### Ask it about the factory

![The agent answering "which run made the most money, and where is its constraint?" with the tool calls it made shown above the answer](docs/screenshots/agent-analyst.png)

Eight read-only tools cover the run list, a run's P&L, windowed metrics, the
floor snapshot, the capital log, both sides of the order book and the facility
settings. Answers stream to the `/agent` page as server-sent events. Each tool
call appears as a chip above the reply, so you can see what the agent looked
at. Here it read the P&L of every run, picked the winner, then read that run's
metrics and floor to find the constraint by name.

The tool docstrings matter because the model plans from them. They spell out
domain rules that a capable reader can still get wrong: money is integer
cents; throughput is money made through sales, never a count of parts;
`netCents` is the score and can be negative; and utilization must come from a
time window, not a single snapshot.

### Ask it to test a decision

> *"Run #78 is at Day 4 · 0:00. Is a second machine at its constraint worth
> buying? Fork it into a control and a branch that buys one and hires someone
> to run it, advance both to Day 8 · 0:00, and tell me which won and why."*

![The agent reads the run, names the Drill Press as the constraint, and proposes a bounded experiment that waits for approval](docs/screenshots/agent-plan.png)

It starts by reading the run. It finds the Drill Press at 99.2% utilization
over the first three days and prices the decision at the run's frozen rates:
$1,200 for the machine and $288 for the hire. Then, instead of stopping at each write, it calls
`propose_experiment`, so a person approves the **whole experiment** once. The
approval is bounded on four axes, and each one pauses on its own if exceeded:

- **Which runs.** A call against any other run pauses, so a plan about the
  fork can't quietly touch the control it's measured against.
- **Which verbs.** Approving advances is not approving purchases.
- **A tick horizon.** Here the agent may advance only as far as Day 8 · 0:00.
- **A spend ceiling,** checked against the sim's frozen price for each action,
  never against a figure the model supplied.

The fork's id (#79) didn't exist when the first plan was approved, so that
plan can't cover it. The agent forks, then asks again for exactly what's
left: buy and hire on #79 only, then advance both runs to Day 8.

![The standing grant shown as a banner with its bounds and remaining spend, above a streaming progress bar with Stop](docs/screenshots/agent-running.png)

While a grant is active it stays on screen: its bounds, what's left of the
ceiling (updated as each charge lands), and a **Revoke** button that writes
directly to the graph state rather than asking the model to stop. Advancing a
branch four days takes several backend requests (the API caps one advance at
20,000 ticks). `advance_to_tick` splits the jump into those requests inside a
single approved call and streams progress. **Stop** halts at a tick boundary
the backend has already committed and never aborts a request in flight, so a
stopped experiment can always resume.

### The verdict is computed, not written

![The verdict card: per-line P&L for both branches with diverging effect-on-net bars](docs/screenshots/agent-verdict.png)

Both runs' P&L comes from frozen columns and the simulation is deterministic,
so "which branch won, by how much, and which P&L line moved" is a calculation.
That is the number an experiment exists to produce, and the model is not
allowed to retype it. `comparator.py` is pure, tested code with no LLM in it.
It **refuses** to compare runs stopped at different ticks, because that would
measure elapsed time rather than the decision. For a parent and its fork it
measures **from the fork point**, since before it the two branches are
identical. The effects on each line always add up exactly to the change in net
profit.

Here it reads: **+$6,024 of throughput** paid for $1,488 of capital, $1,200
of extra rent and $576 of extra wages, and the branch won by **$2,825.97 in
four days**, with 158 more units shipped and the 95th-percentile cycle time
down 4.2 hours. Because the simulation is deterministic, this isn't a lucky
draw: the agent ran the same experiment three times while these screenshots
were being made (#72 vs #73, #76 vs #77, #78 vs #79), in separate
conversations, and all three produced $2,825.97 to the cent.

![The agent's write-up: the result table, and why it won, with the constraint moving to the Cutter](docs/screenshots/agent-answer.png)

The write-up explains the result in the factory's terms: what the $1,488 bought,
the extra wages and rent it committed to, and the flow effects behind the
$6,024 of throughput. The verdict's last line shows something the agent picks
up on next: **the constraint moved**. With the Drill Press relieved, the
Cutter (work center 95) is now pinned at 100%, which makes the next decision
a different decision.

![Both branches' net-profit curves on one chart: identical up to the fork line, the branch dropping by the capital spend, then overtaking the control and pulling away](docs/screenshots/trends-fork-payback.png)

"Open both net curves on Trends" links to the pair as URL state. The curves
match exactly up to the dashed fork line. The branch then drops by the capital
it spent, crosses the control during day 4 and pulls away from there. You can
read the payback period straight off the chart.

### Every write stops at a gate

![An approval card for a single capital action, declined: buy a machine at Cutter for $600, machines 1 → 2, operators 1 → 1, and the agent's explanation afterwards](docs/screenshots/agent-capital-approval.png)

Outside an approved plan, every write pauses. What you approve is **what the
sim says, not what the model said**. The gate fetches the run itself and shows
its real name, its tick, the run's frozen price and the configuration the
action would produce. Here the Cutter is the new constraint (100% utilized,
234 parts queued), but it has one operator, so a second machine with nobody to
run it leaves capacity at one. The agent flagged that before asking.
Declining doesn't cancel the turn. The refusal comes back as a tool result,
and the agent reads it and explains why the purchase alone wouldn't have
helped.

### How the authority boundary is built

The boundary is a structural property of the code, not an instruction the model
is trusted to follow:

- **The read/write split is a module boundary.** `tools.py` holds the reads,
  `actions.py` holds the writes, and the gate's list of gated tools is derived
  from `actions.py`, never written by hand. A new verb in `actions.py` is
  gated automatically.
- **The graph is hand-built** (`agent → approval → tools`), not a stock ReAct
  loop. A batch of pure reads skips the gate entirely, so "a read never pauses"
  is guaranteed by the graph's shape. `interrupt_before` can't express that; it
  pauses everything or nothing.
- **Approval payloads are built from the sim,** never from the model's
  arguments. A run id the sim can't confirm is declined before anyone sees it.
- **A grant can only skip a pause it covers.** If a grant is wrong or stale,
  the worst case is an extra question, never an unapproved write. Spend is
  counted when the action is authorised, so even a backend 409 counts against
  the ceiling.
- **Grants live with the conversation** in checkpointed state. A new
  conversation starts with no authority.
- **The concurrency details are pinned down** after reading the langgraph
  source: `durability="sync"` so the approval event can't race the checkpoint
  that makes it resumable, and a per-thread lock so two simultaneous resumes
  can't both execute a write.
- **Model output is untrusted text.** Replies render as markdown through
  `react-markdown` with raw HTML escaped, and the verdict card parses the
  comparator's JSON, never the prose.

### Evals scored against the sim, not against a judge

This is what determinism makes possible. `uv run python -m factory_agent.evals.run`
builds a LangSmith dataset whose **ground truth is computed from the same
backend the agent reads**: the highest net profit across run summaries, the
highest utilization in a run's metrics, the order-book totals, and the
comparator's own verdict on a pair of runs. A wrong answer is simply wrong,
not a disagreement with an LLM judge.

The first suite scored **5/7**, and both failures were real defects rather than
scoring noise:

- The "buy me a machine" trap died on a raised exception when the model passed
  a bad argument, instead of the tool error returning to the model.
- It named the constraint "work center 98" rather than "Drill Press": metrics
  carries ids only, and nothing told it to resolve names off the floor.

Both were cheap fixes. Finding them was the point.

Three examples score **conduct rather than prose**:

- the graph **stopped** on the right call, against the right run;
- a multi-step request pauses on `propose_experiment` rather than on the first
  write;
- "which line moved" is answered by **calling** the comparator, not by
  subtracting two summaries.

When no comparable pair of runs exists, the comparison examples are left out
and the runner says so, because a smaller suite that still scores 100% is the
quiet regression evals exist to catch. The suite never resumes a pause, so
running it can't change the simulation, whatever the agent answers.

---

## The tour

### The floor — what is happening right now

![The simulator's Floor tab: per-work-centre status, machines, progress, queue depth](docs/screenshots/floor.png)

One row per work centre, redrawn as the run advances. `Starved` / `Running` /
`Saturated` are the only three states a snapshot can honestly distinguish, so
they're the only three there are. The run bar above is the whole state of the
world: simulated day and time, tick, WIP on the floor, money in, net profit,
the seed, and — for a fork — where it branched from.

A run is a server-side object. Reload the page, come back tomorrow, open it in
two tabs: it's the same run at the same tick, because the browser holds no
simulation state at all.

### The dashboard — a P&L over any window

![The Dashboard tab: net profit and the five money lines, deliveries per sales order, the capital log, and work centres ranked by utilization](docs/screenshots/dashboard.png)

Net profit leads, because everything else is an input to it:

```
net = throughput − operating expense − carrying cost − wages − capital spend
```

Then the things that explain it: on-time delivery per sales order (which
promise broke, not just how many), cycle time as median and p95, scrap, WIP
mean and peak, and the work centres ranked by utilization with the constraint on
top.

Read that ranking against the fork above. Having bought the second press, the
drill press has dropped to 87% and **the Cutter is now the constraint at 96%** —
the bottleneck moved, which is exactly what Goldratt says happens and exactly
what makes the next decision a different decision.

Every figure is windowed, and the window is stated. The same work centre read
10% utilization over a whole run and 52% over the ticks it was actually working;
an unlabelled average is a lie with a number in it.

### Capital actions — decisions that cost money up front

![The capital actions dialog: machines, operators, rent and wages per day, with buy/retire and hire/let-go priced per centre](docs/screenshots/capital-dialog.png)

Buying is a whole-factory question, so it gets the whole factory in one table:
what each centre has, what it costs per day, and what changing it costs now. A
centre runs `min(machines, operators)`, so a machine nobody staffs is rent with
no output and an operator with no machine is a wage with no output.

The prices are the run's **own frozen prices**. Edit the master data mid-run and
this run neither sees the new number nor is charged it — that's what makes two
forks comparable. Spend is charged as a lump at the tick it lands (a five-year
amortisation would be ~$11/day against a ~$3,300/day factory, i.e. free, i.e.
"always buy" wins and the decision stops being a decision).

### Release policies — how work reaches the floor

![The release policy dialog: manual, CONWIP, due-date and drum-buffer-rope](docs/screenshots/policy-dialog.png)

A run can feed its own floor as it advances: **CONWIP** (hold floor WIP under a
cap), **due-date** (release each order a lead time before its promise), or
**drum-buffer-rope** (pace releases to the constraint's queue). Priority is
earliest due date throughout. It's a per-run setting frozen at creation and
changeable any time under the run's lock, so two forks can play the same order
book under different release rules — the comparison the whole app is shaped
around.

Releasing everything on day one is always available, and always expensive:
material on the floor accrues a carrying charge per day, so "release less" has a
number attached to it.

### The factory is data

![The routing editor: ordered steps with work centre, process time, setup time and scrap rate](docs/screenshots/routing-steps.png)

Parts, work centres, routings with ordered steps, work orders, sales orders with
due dates, and the allocations that link them. Besides its work centre, a
routing step carries three numbers that make it behave like an operation rather
than a delay: a nominal process time (sampled ±30% per unit), a changeover time
paid once per work order, and a scrap rate in basis points, drawn at step
completion — so the machine time is spent and _then_ the unit fails.

![Work orders with the open-demand panel: unfilled sales orders net of uncommitted supply](docs/screenshots/work-orders.png)

Demand and supply are separate objects joined by allocations, which is what
makes a finished unit worth money: a unit covered by an allocation earns
`unit price − material cost`, and a unit beyond the allocated quantity earns
nothing at all. Finish order therefore decides which sales order — and which
price — a unit is credited to.

---

## How it works

### The engine

`backend/src/simulation/` is pure functions: tick the floor, sample a process
time, accrue a rate, credit a finished part, aggregate a window. No database, no
HTTP, no `Date.now()`. That's why its 231 tests run in 150 milliseconds and why
the rules are the tests rather than the other way round.

- **One tick is one staffed second.** A calendar day is `shifts × 28,800` ticks.
  Off-shift time isn't simulated and isn't skipped-with-gaps — it simply isn't
  ticks, which is what makes a second shift double the day's wage bill while
  amortising the same rent.
- **Money is integer cents, everywhere.** Rates are accrued as an exact integer
  floor-difference of the tick number, so splitting a run into batches can't
  drift and a full day sums to exactly the daily rate. Carrying cost is the one
  true accumulator (it depends on what sat on the floor), and it keeps its
  remainder in the run row so the lifetime charge is exact however the run was
  chunked.
- **Nothing is derived after the fact that can be observed as it happens.** A
  machine that finished a part during a tick was busy for all of it and is empty
  by the time anything could look, so the tick emits its own metrics — busy
  machines, queue depth, and the effective capacity it admitted against.

### Determinism, and why it's load-bearing

Randomness is not drawn at call time. A process time is a pure function of
`(seed, workOrderId, unitIndex, stepIndex)`, hashed and avalanched, with scrap
drawn from a second independent domain over the same key. A run therefore
persists one integer — its seed — and no cursor. Re-create it, resume it, fork
it: every draw comes back identical.

This broke once, instructively. The draw key used to include the part's UUID,
which is minted fresh at every release — so two runs created with the same seed
drew different noise, and comparing them measured the dice instead of the
decision. `UNIQUE(run_id, work_order_id, unit_index)` is what makes the current
key name exactly one part.

### A run freezes the factory it was created with

Once a run exists, the engine reads that run's own copy of the config —
machines, operators, standing costs, wages, capital prices, facility rates,
shift width — and never the live tables again. Routing steps are pinned per
**work order** at release, so editing a routing changes only later releases and
never re-plans a part already halfway down a route.

That's what lets two runs disagree about the drill press, and it's what makes
forking a copy rather than a versioning scheme: `POST /api/runs/:id/fork` copies
every `run_*` table row-for-row under the parent's lock, in one transaction. A
replay-identity check (`npm run check:fork`) proves the branches stay
byte-identical until a decision separates them.

The frozen config has exactly two writers — a capital action, which charges the
run's own price and appends an append-only log row, and a policy change. Neither
touches the shared factory, and no read ever re-derives money from a rate: the
cents are frozen into the row when they're spent or earned, so a later edit
cannot rewrite what a finished run did.

### Persistence and the advance loop

`POST /api/runs/:id/advance {ticks}` loads the run once, ticks it in memory and
writes once per 3,600-tick batch — one transaction each, so a crash costs at
most one simulated hour and never leaves a half-written run. Advancing takes a
row-level `advancing` lock; a release, a capital action or a policy change
landing mid-batch would be overwritten by the write that follows it, so all four
contend for the same lock and a 409 is a real answer rather than a race. A stale
lock (a killed process) is clearable from the UI, worded as an assertion the
user is making rather than a retry.

Observations are stored per simulated minute on an absolute grid — every field a
sum, a count or a max, never a mean, so grouping is lossless and you divide once
at the end. WIP needs three fields, because a level isn't a flow: the mean's
numerator, the peak, and the closing value. That change alone took a whole-run
metrics read on a 15-day playthrough from 7.4s to 1.13s with every reported
figure byte-identical across the migration.

On this machine a loaded floor of 150–280 parts advances at **~8,000 ticks per
second**, so a simulated day takes about four seconds and the fast-forward in
the UI streams it in committed hourly chunks with the charts flying through it.

### The API

A run is driven entirely over HTTP, which is why the UI has no privileges an
agent won't have:

| Endpoint | |
| --- | --- |
| `POST /api/runs` | create a run, freezing the factory's rates, shifts and policy into it |
| `GET /api/runs/:id` | summary and whole-run P&L |
| `POST /api/runs/:id/releases` | put a work order on the floor, pinning its routing steps |
| `POST /api/runs/:id/policy` | change this run's release policy, effective next advance |
| `POST /api/runs/:id/actions` | buy/retire a machine, hire/let an operator go (`GET` lists the log) |
| `POST /api/runs/:id/advance` | tick it forward, ≤ 20,000 ticks per call |
| `POST /api/runs/:id/fork` | copy the run at its current tick into a new branch |
| `GET /api/runs/:id/floor` | snapshot: what's at each centre, how far along |
| `GET /api/runs/:id/metrics` | the P&L, utilization, cycle time, OTD and scrap over a tick window |
| `GET /api/runs/:id/ticks` | the observation series, server-side bucketed |

Plus REST CRUD for the factory definition itself — parts, work centres,
routings, work orders, sales orders, settings. Every body, param and query is
zod-validated, and every error response in the API is `{ message }`, which the
UI toasts verbatim.

An advance answers with more than a tick number: the surviving WIP count, what
scrapped, what the release policy put on the floor, and how many orders remain
releasable — so a caller running until the factory drains stops on the
advance's own answer rather than chasing it with a read that may already be
stale.

### Frontend

The frontend holds no simulation. It had its own copy of the engine once; the
two drifted, and the frontend's was deleted the day the page switched to driving
a server-side run. What's left in `frontend/src/simulation/` is pure display
transforms — cumulative curves, trailing rates, a fork-aware merge of two runs'
net series, tick-to-calendar formatting — each unit-tested like the engine.

A subtlety the cumulative chart forced: `/ticks` returns at most the newest
5,000 rows, so a long run's series is a **suffix**. Accumulating it from zero
would draw a curve that contradicts the money above it, so the opening balance
is derived exactly — the run's total minus the window's own sum, two sums over
the same frozen columns — and the curve carries on from where the run really
was.

---

## Running it

Three independent projects, no monorepo tooling. Node 20.19+ (Vite 8), a
Postgres connection string (Neon, or anything the serverless driver can reach —
the WebSocket `Pool` is used rather than the HTTP driver because writes span
tables and need real transactions), and — for the agent — Python 3.12+ with
[uv](https://docs.astral.sh/uv/) and an OpenAI key. The simulator runs fine
without the third terminal; only the `/agent` page needs it.

```bash
# backend — port 3000, needs backend/.env with DATABASE_URL=postgres://…
cd backend
npm install
npx drizzle-kit migrate
npm run seed        # the playground factory: 10 centres, 10 parts, 29 orders
npm run dev

# frontend — port 5173
cd frontend
npm install
npm run dev

# agent — port 8000, needs agent/.env with OPENAI_API_KEY (see .env.example)
cd agent
uv sync
uv run uvicorn factory_agent.main:app --reload --port 8000
```

Then open the simulator, click **New Run**, pick a release policy, and
fast-forward a day.

```bash
npx vitest run          # backend 231 tests, frontend 159
uv run pytest           # agent 129 tests, no live model calls
npm run check:fork      # backend, live DB: a fork replays its parent exactly
npm run check:policy    # backend, live DB: policies stay isolated per run
```

The seed is tuned rather than arbitrary: ~$3,340/day of burn at one shift, a
constraint ladder (drill press → cutter → mill) that shifts as you buy capacity,
and margins per constraint-second that make the dispatch decision non-obvious.
A 15-day playthrough on it nets **+$42,444 at 100% on-time delivery** if you
expand early, and considerably less if you don't.

---

## Deliberately not built

Being explicit about scope, because half of these are decisions rather than
omissions:

- **No background clock.** Nothing advances a run unattended; a request drives
  it. A background loop would be the first stateful thing in the server process,
  and an agent driving a run wants determinism, not something ticking underneath
  it.
- **No speed multiplier.** The live clock plays one simulated minute per real
  second, and fast-forward jumps in calendar units. A "100×" button starts lying
  the moment it outruns what the server sustains.
- **No cash balance.** A run can't be refused a purchase for want of funds; net
  just goes further negative. Financing is a different game.
- **No late penalty, no scrap write-off.** Both are measured and frozen
  per-part — the due tick a unit was promised, the material a scrapped unit
  cost — so a money penalty is layerable later without rewriting history. Today
  lateness costs you the metric, and scrap costs you the wasted machine time,
  the carrying already paid and the sale that unit didn't make.
- **No event log.** There's a full time series (money, WIP, per-centre occupancy
  and queues per simulated minute) but not an append-only log of discrete
  events. That's the piece a root-cause explainer would need.
- **No BOMs, no multi-level assembly, no machine breakdown, no explicit
  queues.** Queue *depth* is measured; queue *order* isn't a thing you can
  reach in and change yet.
- **Overtime and non-uniform shift calendars.** Overtime's entire economic
  identity is its premium, and a mid-run shift change makes a run's calendar day
  non-uniform while `day_ticks` is currently one frozen integer. It's a
  day-boundary table's worth of work, not a flag.

---

## What's next

The agent can already run one experiment end to end. Next, roughly in order of
how much of each the system can already ground in data it has:

- **An event log**, and root-cause reports over it: given an order that shipped
  late or a day that lost money, walk backwards and name the constraint, the
  queue, the decision.
- **Experiments over more than two branches.** The comparator judges a pair
  today. A sweep (no press, one, two; CONWIP vs DBR) needs the same
  arithmetic ranked across many runs.
- **A durable checkpointer.** `InMemorySaver` means a restart drops pending
  approvals and the agent can run only one uvicorn worker. Both are fine for
  now and neither will be later.
- **Lateness prediction** as a conventional ML problem (real labels, calibrated
  probabilities, features that already exist in the time series) rather than
  something an LLM guesses at.
- **Injected disruption** — breakdowns, absences, rush orders, cost shocks — to
  stress-test a schedule that looks fine when nothing goes wrong.

`PROGRESS.md` is the operational ledger — what shipped, what's next, and the
reasoning behind the sequencing. `CLAUDE.md` holds the design invariants that
the code is expected to keep.
