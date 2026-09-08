# Factory Flow — agent service

The third service in the repo: a Python FastAPI app hosting a LangGraph agent
that drives the simulation **through the backend's REST API only** — it is a
client of the Express backend exactly as the browser is, so it inherits the
run locks, the frozen-config semantics and seed reproducibility for free. The
frontend's `/agent` page calls this service directly (CORS for `:5173`);
Express is never between them.

Scope: an **analyst that runs experiments**. Eight read tools answer
questions like "which run made the most money and where is its constraint?";
six write tools — fork, advance, advance to a tick, capital action, release
policy, manual release — let it test a decision rather than only describe one;
and a **comparator** returns the verdict.

The verdict is **computed, not narrated**. Both runs' P&L is frozen columns
and the sim is deterministic, so "which branch won, by how much, and which
line of the P&L moved" is arithmetic — the model asks for it and interprets
it, and the figures it reports are figures the sim produced. The chat draws
the answer as the table it is.

Changes **wait for a human**, and that boundary is structural rather than a
rule in the prompt: a write tool cannot execute unless a person authorised
it, and reads are routed past the gate entirely, so asking a question never
stops for anyone. Authority is granted **per experiment**: the agent proposes
what it wants to do — which runs, which verbs, how far to advance, the most it
may spend — a person approves those bounds once, and anything outside them
still asks. The grant stays on screen while it stands, with what is left of
its ceiling, and can be revoked. A long advance is one approval too: it chunks
to the backend's cap inside the tool, reports progress as each hour commits,
and can be stopped on a committed boundary.

## Setup

Requires [uv](https://docs.astral.sh/uv/) and Python ≥ 3.12.

```bash
cd agent
cp .env.example .env    # then fill in OPENAI_API_KEY
uv sync                 # creates .venv and installs everything
```

## Run

The full dev setup is three terminals:

```bash
cd backend  && npm run dev     # :3000 — the sim
cd frontend && npm run dev     # :5173 — the UI
cd agent    && uv run uvicorn factory_agent.main:app --reload --port 8000
```

`GET /health` reports whether the backend is reachable — check it first when
tools fail.

## Test / lint

```bash
uv run pytest
uv run ruff check .
```

## Evals (LangSmith)

The suite asks the analyst questions whose answers are **computed from the
sim itself** at eval time — how many runs, which run nets the most, its
constraint by whole-run utilization, its policy, the order-book totals — so a
score is a fact, not a judge's opinion. Where a pair of runs sits at the same
tick it also asks for a verdict, with the **comparator's own output** as the
expected answer; what that scores is whether the prose carries the computed
figures rather than whether the comparator is right, which its unit tests
settle without a model.

Three examples score **conduct rather than prose**, which is what determinism
buys once an agent can act: that the graph *stopped* when told to buy a
machine, on that call against that run; that a multi-step request asks once
for a whole plan instead of stopping at the first write; and that a "which
line moved" question is answered by *calling the comparator*, not by
subtracting two summaries by hand. The suite never resumes a pause, so running
the evals cannot change the simulation however the agent answers.

Setup (once): create a LangSmith account at https://smith.langchain.com →
Settings → API Keys → create a key, then in `agent/.env`:

```
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=lsv2_...
LANGSMITH_PROJECT=factory-flow-agent
```

Run (backend must be up; uses real OpenAI calls, one per question):

```bash
uv run python -m factory_agent.evals.run
```

Rebuilds the `factory-analyst-basic` dataset from the current sim state,
runs the agent on each question in a fresh thread, and prints the experiment
name — scores and traces land in LangSmith. `LANGSMITH_TRACING=true` also
traces normal `/chat` turns.
