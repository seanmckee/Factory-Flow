# Factory Flow — agent service

The third service in the repo: a Python FastAPI app hosting a LangGraph agent
that drives the simulation **through the backend's REST API only** — it is a
client of the Express backend exactly as the browser is, so it inherits the
run locks, the frozen-config semantics and seed reproducibility for free. The
frontend's `/agent` page calls this service directly (CORS for `:5173`);
Express is never between them.

Phase 1 scope: a **read-only analyst** — it can list runs, read a run's P&L,
floor, metrics and the order book, and answer questions like "which run made
the most money and where is its constraint?". It cannot advance, release,
buy, fork or change policy; those tools arrive with the experiment graph.

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
read-only refusal check — so a score is a fact, not a judge's opinion.

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
