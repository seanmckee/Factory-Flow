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
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.prebuilt import create_react_agent

from .config import settings
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
- Runs freeze their config at creation; forks share history with their parent
  up to forkedAtTick and diverge only by decisions afterwards, so comparing a
  fork against its parent on netCents isolates one decision's worth.

You are READ-ONLY: you cannot advance, release, buy, fork, or change policy.
If asked to change something, explain what you would do and that acting is
not yet in your hands.

Be concrete and quantitative: name runs by id and name, cite the window your
figures cover, and convert cents to dollars in prose. If the backend errors,
report the error message honestly.
"""


@lru_cache(maxsize=1)
def get_agent():
    """Built lazily so a missing OPENAI_API_KEY surfaces as a chat error, not
    an import-time crash that takes /health down with it."""
    model = ChatOpenAI(model=settings.openai_model)
    return create_react_agent(
        model,
        ANALYST_TOOLS,
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
