"""Run the basic eval suite against LangSmith.

    uv run python -m factory_agent.evals.run

Needs three things live: the backend on BACKEND_API_BASE (ground truth is
computed from it), OPENAI_API_KEY (the agent answers for real), and
LANGSMITH_API_KEY (where the experiment lands). The dataset is rebuilt from
the current sim state on every invocation — the questions name whichever run
is currently best — and uploaded under one stable dataset name, so LangSmith
accumulates experiments over time against the freshest ground truth.
"""

import asyncio
import os
import sys
import uuid

from dotenv import load_dotenv

load_dotenv()

from langsmith import Client, aevaluate

from .. import sim_client
from ..agent import get_agent
from ..config import settings
from .dataset import best_run, build_examples, correctness

DATASET_NAME = "factory-analyst-basic"


def message_text(message) -> str:
    """A final AI message's text — plain string, or Responses-API block list."""
    content = message.content
    if isinstance(content, str):
        return content
    return "".join(
        part.get("text", "")
        for part in content
        if isinstance(part, dict) and part.get("type") == "text"
    )


async def build_dataset(client: Client) -> str:
    """Fetch the sim, compute ground truth, and replace the dataset's examples."""
    runs = await sim_client.get_json("/api/runs")
    if not runs:
        sys.exit("No runs in the sim — create and advance one before evaluating.")
    summaries = [
        await sim_client.get_json(f"/api/runs/{run['id']}") for run in runs
    ]
    best = best_run(summaries)
    best_metrics = await sim_client.get_json(f"/api/runs/{best['id']}/metrics")
    best_floor = await sim_client.get_json(f"/api/runs/{best['id']}/floor")
    work_orders = await sim_client.get_json("/api/work-orders")

    examples = build_examples(runs, summaries, best_metrics, best_floor, work_orders)

    if client.has_dataset(dataset_name=DATASET_NAME):
        dataset = client.read_dataset(dataset_name=DATASET_NAME)
        # replace wholesale: ground truth moves with the sim, stale examples lie
        for example in client.list_examples(dataset_id=dataset.id):
            client.delete_example(example.id)
    else:
        dataset = client.create_dataset(
            dataset_name=DATASET_NAME,
            description="Factory Flow analyst: questions with ground truth computed from the sim itself.",
        )
    client.create_examples(dataset_id=dataset.id, examples=examples)
    print(f"dataset '{DATASET_NAME}': {len(examples)} examples (best run #{best['id']})")
    return DATASET_NAME


async def target(inputs: dict) -> dict:
    """One eval turn: a fresh thread per question, so examples can't leak
    context into each other."""
    agent = get_agent()
    result = await agent.ainvoke(
        {"messages": [{"role": "user", "content": inputs["question"]}]},
        {"configurable": {"thread_id": f"eval-{uuid.uuid4()}"}},
    )
    return {"answer": message_text(result["messages"][-1])}


async def main() -> None:
    for key in ("OPENAI_API_KEY", "LANGSMITH_API_KEY"):
        if not os.environ.get(key):
            sys.exit(f"{key} is not set — put it in agent/.env")
    client = Client()
    dataset_name = await build_dataset(client)
    results = await aevaluate(
        target,
        data=dataset_name,
        evaluators=[correctness],
        experiment_prefix=f"analyst-{settings.openai_model}",
        max_concurrency=2,
    )
    print(f"experiment: {results.experiment_name}")


if __name__ == "__main__":
    asyncio.run(main())
