"""The phase-2 agent: an analyst that can also act, behind a human gate.

The graph is hand-authored rather than `create_react_agent`, for one reason:
reads must not pause and writes must. `interrupt_before=["tools"]` is all or
nothing, so the pause has to live in a node that can tell the two apart —

                    ┌──reads only──────────────────────┐
                    │                                  ▼
    agent ──tool calls?──▶ approval ──anything cleared?──▶ tools ──▶ agent
      │                        │                                      │
      └──▶ END                 └──all refused──▶ agent ◀──────────────┘

A batch of pure reads is routed straight to `tools`, so "a read never pauses"
is a property of the graph's shape rather than of the gate's internal logic:
the approval node is not entered at all, and no later edit inside it can stop
an analyst's question.

The authority boundary is that `approval` node. It is structural, not a rule
in the prompt: a write tool cannot execute unless a human resumed the thread
for that specific call. Roles (analyst / actor / comparator) are deliberately
NOT split yet — that boundary waits for the deterministic comparator, which
is the node that makes roles mean something.

An interrupted run is resumed with `Command(resume=...)` on the same
`thread_id`, which the checkpointer keys. The approval node re-executes from
the top on resume, so earlier `interrupt()` calls return their recorded
decisions and the next one raises — one approval per HTTP round trip, which
is also how the UI wants it. Its reads re-run too; they are idempotent.
"""

import asyncio
import json
from collections import defaultdict
from collections.abc import AsyncIterator
from functools import lru_cache
from typing import Any

from langchain_core.messages import (
    AIMessage,
    AIMessageChunk,
    SystemMessage,
    ToolMessage,
)
from langchain_core.tools import ToolException
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode
from langgraph.types import Command, interrupt

from .actions import (
    ACTION_TOOL_NAMES,
    ACTION_TOOLS,
    GATED_TOOL_NAMES,
    PROPOSE_TOOL,
    PROPOSE_TOOL_NAME,
)
from .approval import build_approval, build_plan_approval
from .budget import Budget, covers, spend
from .comparator import COMPARATOR_TOOLS
from .config import settings
from .control import clear_stop, emit_plan
from .sim_client import SimApiError
from .tools import ANALYST_TOOLS

SYSTEM_PROMPT = """\
You are the analyst for Factory Flow, a manufacturing simulation inspired by
Goldratt's The Goal. Users ask you about their factory and their simulation
runs; you answer by reading the sim through your tools, and you can change it
through a smaller set of tools that a human must approve first.

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

How to test a decision, which is what this simulator is for:
1. fork_run the run you want to test against. The parent is the CONTROL -
   never act on it, or you have destroyed the thing you were measuring.
2. Take the one decision on the fork (capital_action, set_release_policy,
   release_work_order). One decision per fork; two at once and neither is
   measured.
3. advance_run BOTH branches to the same tickNum, or the comparison is a
   comparison of durations.
4. Call compare_runs(baseline=the control, variant=the branch that acted). It
   computes the verdict from both runs' frozen money columns - never do that
   subtraction yourself, and never report a delta no tool returned. When the
   pair is a fork and its parent it windows from the fork seam for you. Your
   job is to interpret what it returns: which line moved the score, whether
   the decision paid back, and what it cost in on-time delivery, cycle time,
   WIP or scrap.

Changes need a human's approval, and they see the run's real name, its tick
and the run's own frozen price - so say plainly what you intend to do and why
before you call it. If a call comes back declined, do not try to route around
the refusal: say what you would have done and stop. A declined call changed
nothing.

When you intend to take MORE THAN ONE action, call propose_experiment first
and get the whole plan approved at once. Then the actions it covers run
without stopping, and only what falls outside the plan asks again. Ask for the
least that does the job: name the runs you know, the verbs you need, the tick
you will advance to and the most it may spend. A plan that is too small costs
one extra question; a plan that is too large asks a person to hand you power
you did not need, which is worse. Note two things about the bounds: a fork's
new run is NOT covered by the plan that created it, because its id did not
exist when the plan was approved, and a plan cannot cover advance_run - use
advance_to_tick, whose target can be checked against the plan's horizon.

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


# The comparator sits with the reads deliberately: it changes nothing, so the
# gate (which matches on ACTION_TOOL_NAMES, derived from actions.py) routes it
# straight past the approval node like any other question.
ALL_TOOLS = [*ANALYST_TOOLS, *COMPARATOR_TOOLS, *ACTION_TOOLS, PROPOSE_TOOL]

# Shared by /chat and the eval suite - both must see the same error behaviour,
# or the evals measure a different agent than the one the UI talks to.
TOOL_NODE = ToolNode(ALL_TOOLS, handle_tool_errors=tool_error_message)

#: Tools whose *result* the UI can draw, and therefore the only ones whose
#: output crosses the wire. Opt-in rather than opt-out: the floor and metrics
#: payloads are large, the transcript renders none of them, and a chat window
#: is not a place to ship a run's whole observation series. Derived from the
#: tool list rather than hand-written, for the same reason ACTION_TOOL_NAMES
#: is - a name typed twice is a name that eventually disagrees with itself.
RENDERED_TOOL_NAMES = frozenset(verb.name for verb in COMPARATOR_TOOLS)


class ChatState(MessagesState):
    """Messages, plus the tool-call ids a human has cleared to execute.

    The ids matter rather than a bare flag: one AI message can ask for a read
    and a write together, and only the write is gated.
    """

    approved: list[str]
    #: The experiment a human has authorised on this thread, or absent. It is
    #: checkpointed with the messages, which is what lets a grant outlive the
    #: turn that asked for it — and what makes a new conversation start with
    #: no authority, since a new thread has no state.
    budget: Budget | None


def _pending_call_message(messages: list) -> AIMessage | None:
    """The most recent AI message that asked for tools. Not simply the last
    message — the approval node appends refusals after it."""
    for message in reversed(messages):
        if isinstance(message, AIMessage) and message.tool_calls:
            return message
    return None


@lru_cache(maxsize=1)
def get_model():
    """Built lazily so a missing OPENAI_API_KEY surfaces as a chat error, not
    an import-time crash that takes /health down with it."""
    # Responses API, not chat completions: current OpenAI reasoning models
    # (the gpt-5.6/6 family) reject function tools over /v1/chat/completions
    # unless reasoning is turned off entirely.
    model = ChatOpenAI(model=settings.openai_model, use_responses_api=True)
    return model.bind_tools(ALL_TOOLS)


async def call_model(state: ChatState) -> dict:
    response = await get_model().ainvoke(
        [SystemMessage(content=SYSTEM_PROMPT), *state["messages"]]
    )
    return {"messages": [response]}


def refusal(tool_call_id: str, reason: str) -> ToolMessage:
    """A declined write, phrased as a tool result rather than an exception —
    the model reads it and responds, the same shape a backend error takes."""
    return ToolMessage(
        content=f"Not executed: {reason} Nothing in the simulation changed.",
        tool_call_id=tool_call_id,
        status="error",
    )


async def review_calls(state: ChatState) -> dict:
    """The gate. Reads pass; every write waits for a human decision.

    The payload a human sees is built from the sim (`build_approval`), not
    from the model's arguments, so what is approved is what the backend will
    actually do. When the sim cannot confirm the target at all — an invented
    run id, a backend that is down — there is nothing to approve, so the call
    is declined here rather than putting an unknown in front of a person.
    """
    pending = _pending_call_message(state["messages"])
    if pending is None:
        return {"approved": []}

    # Read fresh from the state on every execution of this node, which is
    # what makes the spend accounting safe: the node re-runs from the top on
    # each resume, and a budget derived from the checkpoint each time replays
    # to the same total, where one mutated in place would double-count.
    budget = state.get("budget")
    approved: list[str] = []
    answers: list[ToolMessage] = []
    for call in pending.tool_calls:
        if call["name"] not in GATED_TOOL_NAMES:
            approved.append(call["id"])
            continue

        if call["name"] == PROPOSE_TOOL_NAME:
            payload = await build_plan_approval(call["args"])
            if "error" in payload:
                answers.append(
                    refusal(
                        call["id"],
                        "the simulation could not confirm the plan: "
                        f"{payload['error']}.",
                    )
                )
                continue
            decision = interrupt(payload) or {}
            if not decision.get("approved"):
                note = str(decision.get("note") or "").strip()
                because = f" They said: {note}" if note else ""
                answers.append(
                    refusal(call["id"], f"a human declined the plan.{because}")
                )
                continue
            budget = payload["plan"]
            emit_plan(budget)
            # Answered here rather than executed: the whole effect of asking
            # is the pause and the grant, so there is no tool to run.
            answers.append(
                ToolMessage(
                    content=(
                        "Approved: " + payload["summary"] + " Proceed within "
                        "those bounds; anything outside them will pause again."
                    ),
                    tool_call_id=call["id"],
                )
            )
            continue

        payload = await build_approval(call["name"], call["args"])
        if "error" in payload:
            answers.append(
                refusal(
                    call["id"],
                    f"the simulation could not confirm it: {payload['error']}.",
                )
            )
            continue

        # An approved plan skips the pause for what it covers — and only that.
        # The spend it is checked against is the sim's own frozen quote off
        # the payload, never a number the model supplied.
        quoted = int(payload.get("spendCents") or 0)
        outside = (
            covers(budget, call["name"], call["args"], quoted)
            if budget is not None
            else None
        )
        if budget is not None and outside is None:
            approved.append(call["id"])
            budget = spend(budget, quoted)
            # so the banner's remaining ceiling is live rather than the figure
            # the plan was approved with
            if quoted > 0:
                emit_plan(budget)
            continue

        # `outsidePlan` is present only when a plan IS active and this call
        # falls outside it — the sentence a person needs to judge a pause they
        # thought they had already answered. On a plain one-off write there is
        # no plan to be outside of, and the field would be noise.
        decision = interrupt(
            payload if outside is None else {**payload, "outsidePlan": outside}
        ) or {}
        if decision.get("approved"):
            approved.append(call["id"])
        else:
            note = str(decision.get("note") or "").strip()
            because = f" They said: {note}" if note else ""
            answers.append(refusal(call["id"], f"a human declined it.{because}"))

    return {"messages": answers, "approved": approved, "budget": budget}


async def run_tools(state: ChatState) -> dict:
    """Executes the cleared calls: every read, plus the writes a human
    approved.

    A read is allowed here rather than only in the gate, so that a batch of
    pure reads can route straight past the approval node and still run.
    ToolNode executes every tool call on the message it is handed, so it is
    handed a stub carrying just the allowed ones. Each declined call already
    has its own ToolMessage from the gate, so every tool call still ends up
    with exactly one result — which is what the model's next turn requires.
    """
    pending = _pending_call_message(state["messages"])
    approved = set(state.get("approved") or [])
    waiting = pending.tool_calls if pending else []
    calls = [
        call
        for call in waiting
        # A plan request is never executed — the gate answered it with its own
        # ToolMessage — so it must not reach the tool node even when cleared.
        if call["name"] != PROPOSE_TOOL_NAME
        and (call["name"] not in ACTION_TOOL_NAMES or call["id"] in approved)
    ]
    if not calls:
        return {"approved": []}
    stub = AIMessage(content="", tool_calls=calls)
    result = await TOOL_NODE.ainvoke({"messages": [stub]})
    return {"messages": result["messages"], "approved": []}


def route_after_model(state: ChatState) -> str:
    """Reads bypass the gate entirely.

    "A read never pauses" is then a property of the graph's shape rather than
    of the approval node's internal logic — the node is not even entered, so
    no future edit inside it can accidentally stop an analyst's question.
    """
    calls = getattr(state["messages"][-1], "tool_calls", None)
    if not calls:
        return END
    gated = any(call["name"] in GATED_TOOL_NAMES for call in calls)
    return "approval" if gated else "tools"


def route_after_approval(state: ChatState) -> str:
    """Everything refused means nothing to run — go straight back to the model
    so it can react to the refusal in prose."""
    return "tools" if state.get("approved") else "agent"


def build_graph(checkpointer=None):
    """The graph itself. Separated from `get_agent` so a test can compile one
    with a fake model and its own checkpointer."""
    builder = StateGraph(ChatState)
    builder.add_node("agent", call_model)
    builder.add_node("approval", review_calls)
    builder.add_node("tools", run_tools)
    builder.add_edge(START, "agent")
    builder.add_conditional_edges("agent", route_after_model, ["approval", "tools", END])
    builder.add_conditional_edges("approval", route_after_approval, ["tools", "agent"])
    builder.add_edge("tools", "agent")
    return builder.compile(checkpointer=checkpointer or InMemorySaver())


@lru_cache(maxsize=1)
def get_agent():
    """One graph for the process; the checkpointer keys conversations by
    thread_id. In-memory, so a restart drops any pending approval."""
    return build_graph()


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


def tool_result_event(message: Any) -> dict[str, Any] | None:
    """A tool's own output as an SSE event, for the tools the UI can draw.

    This is the channel a computed answer needs. Until now the transcript saw
    a tool's *name and arguments* and nothing else, so anything a tool worked
    out could only reach the screen as prose the model retyped - which is
    exactly what the comparator exists to stop being the case. What a person
    reads should be built from the tool's own result, the rule `approval.py`
    already applies to a write.

    Content that is not JSON is skipped rather than forwarded: a failed call
    comes back as "Tool call failed: ...", a gated write as the gate's own
    refusal sentence, and both belong to the model to read and explain. A
    result event is for a payload something can render, so a non-payload
    simply is not one.
    """
    name = getattr(message, "name", None)
    if name not in RENDERED_TOOL_NAMES:
        return None
    try:
        data = json.loads(message.content)
    except (TypeError, ValueError):
        return None
    return {"type": "result", "name": name, "data": data}


#: One lock per conversation. Two approvals answered at once — a double
#: click, two tabs — would both pass the "is anything pending?" check and both
#: execute the write. Serialising a thread's turns is what makes that check
#: mean something. Unbounded, like the in-memory checkpointer it guards; both
#: die with the process.
_thread_locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)


async def _stream(agent, payload: Any, thread_id: str) -> AsyncIterator[str]:
    """The shared body of a turn and of a resumed turn: the same SSE
    vocabulary either way — token / tool / result / progress / approval /
    done / error."""
    config = {"configurable": {"thread_id": thread_id}}
    try:
        async for mode, chunk in agent.astream(
            payload,
            config,
            # "custom" is how a long-running tool reports progress: it writes
            # through `get_stream_writer`, which no other mode surfaces.
            stream_mode=["updates", "messages", "custom"],
            # the pause must be checkpointed before the client is told about
            # it, or a fast Approve can race the write that makes it resumable
            durability="sync",
        ):
            if mode == "custom":
                # a tool's own progress payload, already shaped as an event
                if isinstance(chunk, dict):
                    yield sse_event(chunk)
                continue
            if mode == "messages":
                message, _meta = chunk
                if isinstance(message, AIMessageChunk):
                    text = _chunk_text(message)
                    if text:
                        yield sse_event({"type": "token", "text": text})
                continue
            for node, update in chunk.items():
                if node == "__interrupt__":
                    for pause in update:
                        yield sse_event({"type": "approval", **pause.value})
                elif node == "agent" and update:
                    for message in update.get("messages", []):
                        for call in getattr(message, "tool_calls", None) or []:
                            yield sse_event(
                                {
                                    "type": "tool",
                                    "name": call["name"],
                                    "input": call.get("args", {}),
                                }
                            )
                elif node == "tools" and update:
                    for message in update.get("messages", []):
                        result = tool_result_event(message)
                        if result is not None:
                            yield sse_event(result)
        yield sse_event({"type": "done", "threadId": thread_id})
    except Exception as error:  # noqa: BLE001 - surface as an SSE error, never a broken stream
        yield sse_event({"type": "error", "message": str(error)})


async def stream_chat(message: str, thread_id: str) -> AsyncIterator[str]:
    """One user turn, streamed. Ends either finished or waiting on an
    approval; the client tells the two apart by the approval event."""
    try:
        agent = get_agent()
    except Exception as error:  # noqa: BLE001 - any init failure must land in the stream
        yield sse_event({"type": "error", "message": str(error)})
        return
    async with _thread_locks[thread_id]:
        # A Stop that landed after the last long tool finished belongs to that
        # tool, not to this turn — clear it, or a fresh advance is cut short by
        # a click the user made about something else.
        clear_stop(thread_id)
        async for event in _stream(
            agent, {"messages": [{"role": "user", "content": message}]}, thread_id
        ):
            yield event


async def revoke_plan(thread_id: str) -> bool:
    """Take back a granted experiment, so every write pauses again.

    The counterpart to granting: an authority that outlives the turn that
    asked for it must be cancellable without abandoning the conversation.
    Writing the state directly rather than routing it through the model is
    the point — revoking is the human's act, and asking the model to please
    stop using its budget would be a rule in a prompt again.

    Returns whether there was anything to revoke. Takes the thread's lock,
    like every other write to a thread's state.
    """
    agent = get_agent()
    config = {"configurable": {"thread_id": thread_id}}
    async with _thread_locks[thread_id]:
        state = await agent.aget_state(config)
        if not (state.values or {}).get("budget"):
            return False
        await agent.aupdate_state(config, {"budget": None})
        return True


async def stream_resume(
    thread_id: str, approved: bool, note: str | None = None
) -> AsyncIterator[str]:
    """A human's decision on a paused write, and the turn that follows it."""
    try:
        agent = get_agent()
    except Exception as error:  # noqa: BLE001
        yield sse_event({"type": "error", "message": str(error)})
        return

    async with _thread_locks[thread_id]:
        # Same rule as a fresh turn: the human has just approved this write,
        # so a stop from before the pause is not about it.
        clear_stop(thread_id)
        async for event in _resume(agent, thread_id, approved, note):
            yield event


async def _resume(
    agent, thread_id: str, approved: bool, note: str | None
) -> AsyncIterator[str]:
    """Inside the thread's lock: check that something is actually waiting,
    then answer it. The check has to be under the lock — that is the whole
    point of the lock."""
    state = await agent.aget_state({"configurable": {"thread_id": thread_id}})
    if not state.interrupts:
        # a double-click, a stale tab, or a service restart that dropped the
        # in-memory checkpoint — nothing is waiting, and resuming anyway would
        # start an unrelated turn
        yield sse_event(
            {
                "type": "error",
                "message": (
                    "That approval is no longer pending — it was already "
                    "answered, or the agent restarted."
                ),
            }
        )
        yield sse_event({"type": "done", "threadId": thread_id})
        return

    decision = {"approved": approved, "note": note}
    async for event in _stream(agent, Command(resume=decision), thread_id):
        yield event
