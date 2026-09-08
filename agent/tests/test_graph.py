"""The approval gate, exercised through the real graph with a fake model.

No LLM and no network: the model is scripted and the backend is an
`httpx.MockTransport`. What these assert is the property the whole design
rests on — a write tool does not execute unless a human resumed the thread
for that call.
"""

import json

import httpx
from langchain_core.messages import AIMessage, ToolMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from factory_agent import agent as agent_module
from factory_agent.agent import build_graph, stream_resume

from .test_tools import mock_backend

RUN = {
    "id": 39,
    "name": "Playground shakedown",
    "tickNum": 86400,
    "dayTicks": 28800,
    "status": "idle",
    "netCents": 4244443,
    "parentRunId": None,
    "releasePolicy": "manual",
}

FLOOR = {
    "tickNum": 86400,
    "wipCount": 12,
    "workCenters": [
        {
            "workCenterId": 98,
            "name": "Drill Press",
            "capacity": 2,
            "machines": 2,
            "operators": 2,
            "slots": [0.5, None],
            "machinePurchaseCents": 120000,
            "machineSalvageCents": 40000,
            "operatorHireCents": 28800,
        }
    ],
}


class FakeModel:
    """Scripted replies, in order. Also records what the graph asked it."""

    def __init__(self, *responses: AIMessage) -> None:
        self.responses = list(responses)
        self.calls = 0

    def bind_tools(self, tools):
        return self

    async def ainvoke(self, messages):
        self.calls += 1
        return self.responses.pop(0) if self.responses else AIMessage(content="done")


def scripted(monkeypatch, *responses: AIMessage) -> FakeModel:
    model = FakeModel(*responses)
    monkeypatch.setattr(agent_module, "get_model", lambda: model)
    return model


def sim(monkeypatch) -> list[httpx.Request]:
    """A backend that answers the reads the gate makes and records writes."""
    posted: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            posted.append(request)
            if request.url.path.endswith("/actions"):
                return httpx.Response(
                    201,
                    json={
                        "id": 5,
                        "kind": "buy_machine",
                        "workCenterId": 98,
                        "appliedAtTick": 86400,
                        "spendCents": 120000,
                        "machinesAfter": 3,
                        "operatorsAfter": 2,
                    },
                )
            return httpx.Response(201, json={"id": 60, "parentRunId": 39})
        if request.url.path.endswith("/floor"):
            return httpx.Response(200, json=FLOOR)
        return httpx.Response(200, json=RUN)

    mock_backend(monkeypatch, handler)
    return posted


def call(name: str, args: dict, id: str = "c1") -> AIMessage:
    return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": id}])


def thread(name: str) -> dict:
    return {"configurable": {"thread_id": name}}


def turn(text: str) -> dict:
    return {"messages": [{"role": "user", "content": text}]}


async def test_a_read_never_enters_the_gate(monkeypatch):
    """The gate must be invisible to the analyst half. Not merely "does not
    pause" — the approval node is never entered at all, which is what makes
    the property survive future edits inside it."""
    posted = sim(monkeypatch)
    scripted(monkeypatch, call("get_run", {"run_id": 39}), AIMessage(content="Run 39…"))

    async def tripwire(state):
        raise AssertionError("a read reached the approval gate")

    monkeypatch.setattr(agent_module, "review_calls", tripwire)
    graph = build_graph(InMemorySaver())
    config = thread("read")

    await graph.ainvoke(turn("How is run 39 doing?"), config)

    state = await graph.aget_state(config)
    assert state.interrupts == ()
    assert posted == []
    assert state.values["messages"][-1].content == "Run 39…"


async def test_a_computed_verdict_reaches_the_transcript_as_data(monkeypatch):
    """The channel the comparator needs. A tool that works something out must
    be able to put the *result* on the wire, or the only route to the screen
    is prose the model retyped — which is the thing the comparator exists to
    stop."""
    runs = {
        39: {**RUN, "id": 39, "name": "control"},
        40: {
            **RUN,
            "id": 40,
            "name": "second press",
            "parentRunId": 39,
            "forkedAtTick": 28800,
        },
    }
    nets = {39: 100_000, 40: 250_000}

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        run_id = int(path.split("/")[3])
        if path.endswith("/metrics"):
            return httpx.Response(
                200,
                json={
                    "fromTick": 28_800,
                    "toTick": 86_400,
                    "throughputCents": nets[run_id] + 1_000,
                    "operatingExpenseCents": 1_000,
                    "carryingCostCents": 0,
                    "wageCents": 0,
                    "capitalSpendCents": 0,
                    "netCents": nets[run_id],
                    "flow": {"meanWip": 1, "maxWip": 2, "workCenters": []},
                    "cycleTime": {"count": 1, "meanSeconds": 10.0, "p95Seconds": 10},
                    "onTimeDelivery": {"measuredCount": 1, "onTimeFraction": 1.0},
                    "scrap": {"scrappedCount": 0, "scrappedMaterialCents": 0},
                },
            )
        return httpx.Response(200, json=runs[run_id])

    mock_backend(monkeypatch, handler)
    scripted(
        monkeypatch,
        call("compare_runs", {"baseline_run_id": 39, "variant_run_id": 40}),
        AIMessage(content="The press paid back."),
    )
    graph = build_graph(InMemorySaver())

    events = [
        json.loads(line.removeprefix("data: ").strip())
        async for line in agent_module._stream(
            graph, turn("Was it worth it?"), "verdict"
        )
    ]

    results = [event for event in events if event["type"] == "result"]
    assert len(results) == 1
    assert results[0]["name"] == "compare_runs"
    assert results[0]["data"]["netDeltaCents"] == 150_000
    assert results[0]["data"]["winnerRunId"] == 40
    # and the tool call itself still announces itself, as every tool does
    assert [event["name"] for event in events if event["type"] == "tool"] == [
        "compare_runs"
    ]


async def test_a_read_the_ui_cannot_draw_puts_nothing_on_the_wire(monkeypatch):
    sim(monkeypatch)
    scripted(monkeypatch, call("get_run", {"run_id": 39}), AIMessage(content="Fine."))
    graph = build_graph(InMemorySaver())

    events = [
        json.loads(line.removeprefix("data: ").strip())
        async for line in agent_module._stream(graph, turn("How is run 39?"), "plain")
    ]

    assert [event["type"] for event in events if event["type"] == "result"] == []


async def test_a_write_pauses_and_shows_the_sim_s_own_numbers(monkeypatch):
    posted = sim(monkeypatch)
    scripted(
        monkeypatch,
        call("capital_action", {"run_id": 39, "kind": "buy_machine", "work_center_id": 98}),
    )
    graph = build_graph(InMemorySaver())
    config = thread("write")

    await graph.ainvoke(turn("Buy a machine at the drill press in run 39"), config)

    state = await graph.aget_state(config)
    assert len(state.interrupts) == 1
    payload = state.interrupts[0].value
    # the run is named from GET /api/runs/39, not from anything the model said
    assert payload["run"]["name"] == "Playground shakedown"
    assert payload["tool"] == "capital_action"
    assert "Drill Press" in payload["summary"]
    assert "$1,200.00" in payload["summary"]
    assert "2 → 3" in payload["summary"]
    # and nothing has happened yet
    assert posted == []


async def test_approving_executes_the_write(monkeypatch):
    posted = sim(monkeypatch)
    scripted(
        monkeypatch,
        call("capital_action", {"run_id": 39, "kind": "buy_machine", "work_center_id": 98}),
        AIMessage(content="Bought it."),
    )
    graph = build_graph(InMemorySaver())
    config = thread("approve")

    await graph.ainvoke(turn("Buy a machine"), config)
    await graph.ainvoke(Command(resume={"approved": True}), config)

    assert [request.url.path for request in posted] == ["/api/runs/39/actions"]
    assert json.loads(posted[0].content) == {"kind": "buy_machine", "workCenterId": 98}
    state = await graph.aget_state(config)
    assert state.interrupts == ()


async def test_rejecting_changes_nothing_and_tells_the_model_why(monkeypatch):
    posted = sim(monkeypatch)
    scripted(
        monkeypatch,
        call("capital_action", {"run_id": 39, "kind": "buy_machine", "work_center_id": 98}),
        AIMessage(content="Understood — I won't buy it."),
    )
    graph = build_graph(InMemorySaver())
    config = thread("reject")

    await graph.ainvoke(turn("Buy a machine"), config)
    await graph.ainvoke(
        Command(resume={"approved": False, "note": "too early to spend"}), config
    )

    assert posted == []
    messages = (await graph.aget_state(config)).values["messages"]
    declined = [m for m in messages if isinstance(m, ToolMessage)]
    assert len(declined) == 1
    # a refusal is a tool result the model reads, not an exception
    assert declined[0].status == "error"
    assert "a human declined it" in declined[0].content
    assert "too early to spend" in declined[0].content
    assert messages[-1].content == "Understood — I won't buy it."


async def test_an_unconfirmable_run_is_declined_without_asking_anyone(monkeypatch):
    """A run id the model invented has nothing to confirm. Better to hand the
    404 back to the model than to put an unknown in front of a person."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            raise AssertionError("must not write")
        return httpx.Response(404, json={"message": "Run 999 not found"})

    mock_backend(monkeypatch, handler)
    scripted(
        monkeypatch,
        call("advance_run", {"run_id": 999, "ticks": 3600}),
        AIMessage(content="That run does not exist."),
    )
    graph = build_graph(InMemorySaver())
    config = thread("ghost")

    await graph.ainvoke(turn("Advance run 999"), config)

    state = await graph.aget_state(config)
    assert state.interrupts == ()
    declined = [m for m in state.values["messages"] if isinstance(m, ToolMessage)]
    assert "Run 999 not found" in declined[0].content


async def test_a_mixed_batch_gates_only_the_write(monkeypatch):
    """One AI message asking for a read and a write: the read is cleared
    automatically, the write still stops the graph, and neither runs until the
    decision comes back — a node returns all at once or not at all."""
    posted = sim(monkeypatch)
    both = AIMessage(
        content="",
        tool_calls=[
            {"name": "get_run", "args": {"run_id": 39}, "id": "read1"},
            {"name": "fork_run", "args": {"run_id": 39}, "id": "write1"},
        ],
    )
    scripted(monkeypatch, both, AIMessage(content="Forked."))
    graph = build_graph(InMemorySaver())
    config = thread("mixed")

    await graph.ainvoke(turn("Read run 39 then fork it"), config)
    assert len((await graph.aget_state(config)).interrupts) == 1
    assert posted == []

    await graph.ainvoke(Command(resume={"approved": True}), config)

    results = {
        m.tool_call_id: m
        for m in (await graph.aget_state(config)).values["messages"]
        if isinstance(m, ToolMessage)
    }
    assert set(results) == {"read1", "write1"}
    assert [request.url.path for request in posted] == ["/api/runs/39/fork"]


async def test_two_writes_take_two_decisions(monkeypatch):
    """Two write calls in one message pause twice — one approval per round
    trip, because the node re-runs from the top and the next interrupt fires."""
    posted = sim(monkeypatch)
    both = AIMessage(
        content="",
        tool_calls=[
            {"name": "fork_run", "args": {"run_id": 39}, "id": "w1"},
            {
                "name": "capital_action",
                "args": {"run_id": 39, "kind": "buy_machine", "work_center_id": 98},
                "id": "w2",
            },
        ],
    )
    scripted(monkeypatch, both, AIMessage(content="Both done."))
    graph = build_graph(InMemorySaver())
    config = thread("two")

    await graph.ainvoke(turn("Fork it and buy a machine"), config)
    first = (await graph.aget_state(config)).interrupts[0].value
    assert first["tool"] == "fork_run"

    await graph.ainvoke(Command(resume={"approved": True}), config)
    pending = (await graph.aget_state(config)).interrupts
    assert len(pending) == 1
    assert pending[0].value["tool"] == "capital_action"
    assert posted == []  # still nothing written — the batch runs together

    await graph.ainvoke(Command(resume={"approved": True}), config)
    assert [request.url.path for request in posted] == [
        "/api/runs/39/fork",
        "/api/runs/39/actions",
    ]


async def test_resuming_nothing_is_an_error_not_a_fresh_turn(monkeypatch):
    """A stale tab, a double click, or a restart that dropped the in-memory
    checkpoint. Resuming an unknown thread would otherwise start the graph
    from the beginning on empty state and burn a model call."""
    sim(monkeypatch)
    model = scripted(monkeypatch, AIMessage(content="should never run"))
    monkeypatch.setattr(agent_module, "get_agent", lambda: build_graph(InMemorySaver()))

    events = [event async for event in stream_resume("never-paused", approved=True)]

    assert model.calls == 0
    assert any('"type": "error"' in event for event in events)
    assert "no longer pending" in "".join(events)
