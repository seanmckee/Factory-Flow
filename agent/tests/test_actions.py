"""The write tools against a mocked backend — no network, no LLM.

What's worth testing here is the wire: these tools are a thin translation from
snake_case Python arguments onto the API's camelCase bodies, and a silently
mistyped key is a 400 the model has to puzzle out at runtime.
"""

import json as jsonlib

import httpx
import pytest
from langchain_core.tools import ToolException

from factory_agent import control, sim_client
from factory_agent.actions import (
    ACTION_TOOL_NAMES,
    advance_run,
    advance_to_tick,
    capital_action,
    fork_run,
    release_work_order,
    set_release_policy,
)

from .test_tools import mock_backend


def record(status: int, payload: dict) -> tuple[dict, object]:
    """A handler that captures the request it received, so a test can assert
    on the path and the exact JSON body the tool sent."""
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        import json

        seen["method"] = request.method
        seen["path"] = request.url.path
        seen["body"] = json.loads(request.content) if request.content else None
        return httpx.Response(status, json=payload)

    return seen, handler


async def test_fork_posts_an_empty_body_without_a_name(monkeypatch):
    seen, handler = record(201, {"id": 60, "parentRunId": 39})
    mock_backend(monkeypatch, handler)
    result = await fork_run.ainvoke({"run_id": 39})
    assert seen["method"] == "POST"
    assert seen["path"] == "/api/runs/39/fork"
    # {} not {"name": null} — the backend derives the fork's name when the key
    # is absent, and a null would fail validation
    assert seen["body"] == {}
    assert result == '{"id":60,"parentRunId":39}'


async def test_fork_passes_a_name_through(monkeypatch):
    seen, handler = record(201, {"id": 61})
    mock_backend(monkeypatch, handler)
    await fork_run.ainvoke({"run_id": 39, "name": "Second drill press"})
    assert seen["body"] == {"name": "Second drill press"}


async def test_advance_sends_ticks(monkeypatch):
    seen, handler = record(200, {"tickNum": 3600, "wipCount": 12})
    mock_backend(monkeypatch, handler)
    await advance_run.ainvoke({"run_id": 39, "ticks": 3600})
    assert seen["path"] == "/api/runs/39/advance"
    assert seen["body"] == {"ticks": 3600}


async def test_capital_action_sends_camel_case_work_center(monkeypatch):
    seen, handler = record(201, {"id": 4, "spendCents": 120000})
    mock_backend(monkeypatch, handler)
    await capital_action.ainvoke(
        {"run_id": 39, "kind": "buy_machine", "work_center_id": 98}
    )
    assert seen["path"] == "/api/runs/39/actions"
    assert seen["body"] == {"kind": "buy_machine", "workCenterId": 98}
    # no money field: the run charges its own frozen price
    assert "spendCents" not in seen["body"]


async def test_release_sends_camel_case_work_order(monkeypatch):
    seen, handler = record(201, {"workOrderId": 7, "partsReleased": 50})
    mock_backend(monkeypatch, handler)
    await release_work_order.ainvoke({"run_id": 39, "work_order_id": 7})
    assert seen["path"] == "/api/runs/39/releases"
    assert seen["body"] == {"workOrderId": 7}


class TestPolicyMerge:
    """Omitted numbers must be absent from the body, not sent as null: the
    backend keeps the run's current value for an absent key and would reject
    (or misread) a null."""

    async def test_only_the_policy_when_nothing_else_is_given(self, monkeypatch):
        seen, handler = record(200, {"id": 39, "releasePolicy": "conwip"})
        mock_backend(monkeypatch, handler)
        await set_release_policy.ainvoke({"run_id": 39, "release_policy": "conwip"})
        assert seen["path"] == "/api/runs/39/policy"
        assert seen["body"] == {"releasePolicy": "conwip"}

    async def test_numbers_pass_through(self, monkeypatch):
        seen, handler = record(200, {"id": 39})
        mock_backend(monkeypatch, handler)
        await set_release_policy.ainvoke(
            {
                "run_id": 39,
                "release_policy": "dbr",
                "wip_cap": 150,
                "release_lead_days": 2,
                "drum_work_center_id": 98,
                "drum_buffer": 40,
            }
        )
        assert seen["body"] == {
            "releasePolicy": "dbr",
            "wipCap": 150,
            "releaseLeadDays": 2,
            "drumWorkCenterId": 98,
            "drumBuffer": 40,
        }

    async def test_clear_drum_sends_an_explicit_null(self, monkeypatch):
        seen, handler = record(200, {"id": 39})
        mock_backend(monkeypatch, handler)
        await set_release_policy.ainvoke(
            {"run_id": 39, "release_policy": "conwip", "clear_drum": True}
        )
        # null clears the drum; absent would have kept it — the whole reason
        # clearing is its own flag rather than a None default
        assert seen["body"] == {"releasePolicy": "conwip", "drumWorkCenterId": None}

    async def test_clear_drum_wins_over_an_id(self, monkeypatch):
        seen, handler = record(200, {"id": 39})
        mock_backend(monkeypatch, handler)
        await set_release_policy.ainvoke(
            {
                "run_id": 39,
                "release_policy": "conwip",
                "drum_work_center_id": 98,
                "clear_drum": True,
            }
        )
        assert seen["body"]["drumWorkCenterId"] is None


async def test_a_lock_conflict_is_a_sim_error(monkeypatch):
    """409 from the run lock reaches the tool layer as SimApiError, which the
    tool node turns into a message the model can read (8.6)."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(409, json={"message": "Run 39 is already advancing"})

    mock_backend(monkeypatch, handler)
    with pytest.raises(sim_client.SimApiError) as caught:
        await advance_run.ainvoke({"run_id": 39, "ticks": 60})
    assert caught.value.status == 409
    assert "already advancing" in caught.value.message


async def test_a_domain_conflict_is_the_same_shape(monkeypatch):
    """The API's other 409 — a real conflict rather than the lock. Same shape
    on the wire, so the model has only the message to tell them apart."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            409, json={"message": "Work center 98 has no machines to retire"}
        )

    mock_backend(monkeypatch, handler)
    with pytest.raises(sim_client.SimApiError) as caught:
        await capital_action.ainvoke(
            {"run_id": 39, "kind": "retire_machine", "work_center_id": 98}
        )
    assert caught.value.status == 409




class TestAdvanceToTick:
    """The chunking loop. The backend caps one advance at 20,000 ticks and a
    staffed day is 28,800, so a 15-day jump was 22 approvals a branch — 44 for
    an experiment, 43 of them "yes, keep going". Doing the chunking inside one
    tool takes that to one approval without changing anything about authority.
    """

    def sim(self, monkeypatch, *, day_ticks: int = 28_800, start: int = 0):
        """A backend that advances a run for real, in whatever steps it is
        asked for, and records each request."""
        state = {"tick": start}
        asked: list[int] = []

        def handler(request: httpx.Request) -> httpx.Response:
            if request.method == "GET":
                return httpx.Response(
                    200,
                    json={
                        "id": 39,
                        "name": "run",
                        "tickNum": state["tick"],
                        "dayTicks": day_ticks,
                        "wipCount": 7,
                    },
                )
            ticks = jsonlib.loads(request.content)["ticks"]
            asked.append(ticks)
            state["tick"] += ticks
            return httpx.Response(
                200,
                json={
                    "tickNum": state["tick"],
                    "ticksAdvanced": ticks,
                    "throughputCents": 100 * ticks,
                    "operatingExpenseCents": 10 * ticks,
                    "carryingCostCents": ticks,
                    "wageCents": 2 * ticks,
                    "scrappedCount": 1,
                    "wipCount": 12,
                    "backlogCount": 3,
                    "autoReleased": [{"workOrderId": 5, "partsReleased": 10}],
                },
            )

        mock_backend(monkeypatch, handler)
        return asked

    async def test_one_call_chunks_a_long_jump_to_the_backend_cap(self, monkeypatch):
        asked = self.sim(monkeypatch)
        result = jsonlib.loads(
            await advance_to_tick.ainvoke({"run_id": 39, "to_tick": 50_000})
        )
        assert asked == [20_000, 20_000, 10_000]
        assert result["tickNum"] == 50_000
        assert result["requests"] == 3
        assert result["ticksAdvanced"] == 50_000
        assert result["stopped"] is False

    async def test_it_lands_exactly_on_the_target(self, monkeypatch):
        # The whole point of an absolute target: two branches advanced to the
        # same to_tick have run for the same time, which is what makes the
        # comparison a comparison of decisions.
        self.sim(monkeypatch, start=13_000)
        result = jsonlib.loads(
            await advance_to_tick.ainvoke({"run_id": 39, "to_tick": 28_800})
        )
        assert result["tickNum"] == 28_800
        assert result["fromTick"] == 13_000

    async def test_money_and_counts_are_summed_over_every_chunk(self, monkeypatch):
        self.sim(monkeypatch)
        result = jsonlib.loads(
            await advance_to_tick.ainvoke({"run_id": 39, "to_tick": 30_000})
        )
        # 30,000 ticks at the fixture's rates, however it was chunked
        assert result["throughputCents"] == 3_000_000
        assert result["wageCents"] == 60_000
        assert result["scrappedCount"] == 2  # one per request
        assert len(result["autoReleased"]) == 2

    async def test_the_last_chunk_reports_the_floor_and_the_backlog(self, monkeypatch):
        self.sim(monkeypatch)
        result = jsonlib.loads(
            await advance_to_tick.ainvoke({"run_id": 39, "to_tick": 5_000})
        )
        assert result["wipCount"] == 12
        assert result["backlogCount"] == 3

    async def test_a_target_already_passed_is_refused_not_silently_ignored(
        self, monkeypatch
    ):
        self.sim(monkeypatch, start=50_000)
        with pytest.raises(ToolException) as caught:
            await advance_to_tick.ainvoke({"run_id": 39, "to_tick": 20_000})
        assert "only moves forward" in str(caught.value)

    async def test_a_stop_lands_on_a_committed_boundary(self, monkeypatch):
        """Stopping keeps every tick the backend committed and says where it
        got to. Not a failure: advancing is resumable, so this is an answer."""
        asked = self.sim(monkeypatch)
        calls = {"n": 0}

        def stop_after_two() -> bool:
            calls["n"] += 1
            return calls["n"] > 2

        monkeypatch.setattr("factory_agent.actions.stop_requested", stop_after_two)
        result = jsonlib.loads(
            await advance_to_tick.ainvoke({"run_id": 39, "to_tick": 100_000})
        )
        assert asked == [20_000, 20_000]
        assert result["stopped"] is True
        assert result["tickNum"] == 40_000
        assert result["requestedToTick"] == 100_000

    async def test_progress_is_emitted_per_committed_chunk(self, monkeypatch):
        seen: list[dict] = []
        self.sim(monkeypatch)
        monkeypatch.setattr(
            "factory_agent.actions.emit_progress", lambda payload: seen.append(payload)
        )
        await advance_to_tick.ainvoke({"run_id": 39, "to_tick": 45_000})
        assert [event["tickNum"] for event in seen] == [20_000, 40_000, 45_000]
        assert seen[0]["toTick"] == 45_000
        assert seen[0]["runId"] == 39


class TestStopRegistry:
    def test_a_stop_is_one_shot(self):
        control.request_stop("t1")
        assert "t1" in control._stop_requests
        control.clear_stop("t1")
        assert "t1" not in control._stop_requests

    def test_clearing_an_unknown_thread_is_harmless(self):
        control.clear_stop("never-seen")

    def test_outside_a_graph_run_nothing_is_stopping(self):
        # A tool called from a test or a script has no thread and no stream;
        # neither may be load-bearing for it doing its work.
        assert control.current_thread_id() is None
        assert control.stop_requested() is False
        control.emit_progress({"tickNum": 1})  # must not raise


def test_every_verb_is_registered_for_approval():
    """ACTION_TOOL_NAMES is what the approval gate matches on — a verb missing
    from it would execute without a pause, which is the one failure this
    module must not have."""
    assert ACTION_TOOL_NAMES == {
        "fork_run",
        "advance_run",
        "advance_to_tick",
        "capital_action",
        "set_release_policy",
        "release_work_order",
    }
