"""The phase-1 agent: a single read-only analyst over the sim's REST API.

One LangGraph ReAct agent with an in-memory checkpointer — `thread_id` keys a
conversation, so follow-ups have memory for the life of the process. This
grows into the analyst node of the Track 8 experiment graph; the supervisor,
actor and comparator come later.
"""

import json
from collections.abc import AsyncIterator
from functools import lru_cache

from langchain_core.messages import AIMessageChunk
from langchain_core.tools import ToolException
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.prebuilt import ToolNode, create_react_agent

from .config import settings
from .sim_client import SimApiError
from .tools import ANALYST_TOOLS

SYSTEM_PROMPT = """\
You are the analyst for Factory Flow, a manufacturing simulation inspired by
Goldratt's The Goal. Users ask you about their factory and their simulation
runs; you answer by reading the sim through your tools.

Domain vocabulary (it differs from casual usage):
- Money is integer cents everywhere. Throughput is money made through SALES
  (unit price minus material cost, only for units covered by an allocation),
  never a count of parts produced.
- A run's score is netCents = throughput - operating expense - carrying cost
  - wages - capital spend. It can be negative; an idle factory loses money,
  because rent and wages accrue against time.
- One tick is one staffed second; a run's dayTicks (shifts x 28,800) make one
  calendar day. Prefer reporting times as days/hours, and money as dollars
  (cents / 100).
- The constraint (bottleneck) is the work center with the highest utilization
  over a window - use get_run_metrics, never a floor snapshot, to rank it.
  Metrics identify work centers by id only, and a run keeps no copy of the
  names: resolve the id through get_run_floor and answer with the NAME
  ("Drill Press", the id in parentheses if it helps). "work center 98" is not
  an answer a person can act on.
- Runs freeze their config at creation; forks share history with their parent
  up to forkedAtTick and diverge only by decisions afterwards, so comparing a
  fork against its parent on netCents isolates one decision's worth.

You are READ-ONLY: you cannot advance, release, buy, fork, or change policy.
If asked to change something, explain what you would do and that acting is
not yet in your hands.

Be concrete and quantitative: name runs by id and name, cite the window your
figures cover, and convert cents to dollars in prose.

A tool call can come back as "Tool call failed: ...". That is a result, not
the end of the turn: read it, fix your arguments and retry if the mistake was
yours, and otherwise tell the user what the backend said. Never fill the gap
with a figure no tool returned.
"""


def tool_error_message(error: SimApiError | ToolException) -> str:
    """What a failed tool call hands back to the model instead of raising.

    A backend 404 from a bad run id is *information*: the model can retry with
    a real id, or tell the user that run does not exist. Raising ends the turn
    - which is how the eval suite's read-only trap failed, the agent dying on a
    404 rather than declining to buy the machine. LangGraph's default handler
    re-raises anything that is not an argument-validation error, so ours has to
    be named explicitly.

    Deliberately narrow, and the annotation is what narrows it (the tool node
    infers the caught types from this signature): a bug in our own code should
    still crash loudly rather than be laundered into the transcript as a fact
    about the factory.
    """
    return f"Tool call failed: {error}"


# Shared by /chat and the eval suite - both must see the same error behaviour,
# or the evals measure a different agent than the one the UI talks to.
ANALYST_TOOL_NODE = ToolNode(ANALYST_TOOLS, handle_tool_errors=tool_error_message)


@lru_cache(maxsize=1)
def get_agent():
    """Built lazily so a missing OPENAI_API_KEY surfaces as a chat error, not
    an import-time crash that takes /health down with it."""
    # Responses API, not chat completions: current OpenAI reasoning models
    # (the gpt-5.6/6 family) reject function tools over /v1/chat/completions
    # unless reasoning is turned off entirely.
    model = ChatOpenAI(model=settings.openai_model, use_responses_api=True)
    return create_react_agent(
        model,
        ANALYST_TOOL_NODE,
        prompt=SYSTEM_PROMPT,
        checkpointer=InMemorySaver(),
    )


def sse_event(event: dict) -> str:
    """One server-sent event carrying a JSON payload."""
    return f"data: {json.dumps(event)}\n\n"


def _chunk_text(chunk: AIMessageChunk) -> str:
    """OpenAI chunks carry a plain string; other providers a block list."""
    if isinstance(chunk.content, str):
        return chunk.content
    return "".join(
        part.get("text", "")
        for part in chunk.content
        if isinstance(part, dict) and part.get("type") == "text"
    )


async def stream_chat(message: str, thread_id: str) -> AsyncIterator[str]:
    """The /chat body: runs one user turn and yields SSE events —
    {type: token|tool|done|error}. Tool events fire when the model decides to
    call a tool, so the UI can show what the agent is looking at."""
    try:
        agent = get_agent()
    except Exception as error:  # noqa: BLE001 - any init failure must land in the stream
        yield sse_event({"type": "error", "message": str(error)})
        return

    config = {"configurable": {"thread_id": thread_id}}
    try:
        async for mode, payload in agent.astream(
            {"messages": [{"role": "user", "content": message}]},
            config,
            stream_mode=["updates", "messages"],
        ):
            if mode == "messages":
                chunk, _meta = payload
                if isinstance(chunk, AIMessageChunk):
                    text = _chunk_text(chunk)
                    if text:
                        yield sse_event({"type": "token", "text": text})
            elif mode == "updates":
                for node, update in payload.items():
                    if node != "agent" or not update:
                        continue
                    for msg in update.get("messages", []):
                        for call in getattr(msg, "tool_calls", None) or []:
                            yield sse_event(
                                {
                                    "type": "tool",
                                    "name": call["name"],
                                    "input": call.get("args", {}),
                                }
                            )
        yield sse_event({"type": "done", "threadId": thread_id})
    except Exception as error:  # noqa: BLE001 - surface as an SSE error, never a broken stream
        yield sse_event({"type": "error", "message": str(error)})
