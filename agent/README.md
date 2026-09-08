# Factory Flow — agent service

The third service in the repo: a Python FastAPI app hosting a LangGraph agent
that drives the simulation **through the backend's REST API only** — it is a
client of the Express backend exactly as the browser is, so it inherits the
run locks, the frozen-config semantics and seed reproducibility for free. The
frontend's `/agent` page calls this service directly (CORS for `:5173`);
Express is never between them.

Scope: an **analyst that can also act**. Eight read tools answer questions
like "which run made the most money and where is its constraint?"; five write
tools — fork, advance, capital action, release policy, manual release — let it
test a decision rather than only describe one.

Every write **pauses for a human**. The graph stops before the call executes
and surfaces the run's real name, its tick and the run's own frozen price;
nothing is written until someone approves it on the `/agent` page. That is
structural rather than a rule in the prompt — the tool cannot run unless the
thread is resumed for that specific call — and reads are routed past the gate
entirely, so asking a question never stops for anyone.

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

The basic suite asks the analyst questions whose answers are **computed from
the sim itself** at eval time — how many runs, which run nets the most, its
constraint by whole-run utilization, its policy, the order-book totals, and a
gate check — so a score is a fact, not a judge's opinion. The gate example
scores conduct rather than prose: the agent is told to buy a machine, and what
is scored is that the graph *stopped* on that call against that run. The suite
never resumes a pause, so running the evals cannot change the simulation.

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
