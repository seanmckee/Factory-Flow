"""The verdict, tested with no LLM, no network and no database.

That is the whole point of the comparator existing: if the answer to "which
branch won" needs a model, it cannot be pinned by a test.
"""

import json

import httpx
import pytest
from langchain_core.tools import ToolException

from factory_agent import sim_client
from factory_agent.comparator import (
    PL_LINES,
    compare,
    compare_pl,
    compare_runs,
    comparison_window,
    constraint_of,
    verdict_line,
)


def run_row(**overrides) -> dict:
    row = {
        "id": 1,
        "name": "baseline",
        "tickNum": 57_600,
        "dayTicks": 28_800,
        "parentRunId": None,
        "forkedAtTick": None,
    }
    return {**row, **overrides}


def metrics(**overrides) -> dict:
    """A whole-run /metrics response, trimmed to what the comparator reads."""
    payload = {
        "fromTick": 0,
        "toTick": 57_600,
        "throughputCents": 500_000,
        "operatingExpenseCents": 200_000,
        "carryingCostCents": 10_000,
        "wageCents": 50_000,
        "capitalSpendCents": 0,
        "netCents": 240_000,
        "flow": {
            "meanWip": 12.5,
            "maxWip": 40,
            "finalWip": 3,
            "workCenters": [
                {
                    "workCenterId": 7,
                    "utilization": 0.5,
                    "busyMachineTicks": 100,
                    "capacityTicks": 200,
                    "meanQueueDepth": 1.0,
                    "maxQueueDepth": 4,
                },
            ],
        },
        "cycleTime": {
            "count": 40,
            "meanSeconds": 900.0,
            "medianSeconds": 850,
            "p95Seconds": 1800,
            "minSeconds": 400,
            "maxSeconds": 2000,
        },
        "onTimeDelivery": {
            "measuredCount": 40,
            "onTimeCount": 38,
            "lateCount": 2,
            "onTimeFraction": 0.95,
            "meanLatenessSeconds": 300.0,
            "maxLatenessSeconds": 600,
        },
        "scrap": {"scrappedCount": 2, "scrappedMaterialCents": 4_000},
    }
    return {**payload, **overrides}


# --- the window ------------------------------------------------------------


def test_unrelated_runs_compare_over_the_whole_run_from_tick_zero():
    # tick 0 is a real moment: a capital action can land before the first
    # advance, and defaulting to 1 would hide that spend from the verdict.
    window = comparison_window(run_row(id=1), run_row(id=2))
    assert window["fromTick"] == 0
    assert window["forkedAtTick"] is None
    assert window["basis"] == "whole run"


def test_a_fork_is_compared_from_the_seam():
    parent = run_row(id=1)
    fork = run_row(id=2, name="two presses", parentRunId=1, forkedAtTick=28_800)
    window = comparison_window(parent, fork)
    assert window["fromTick"] == 28_800
    assert window["basis"] == "since the fork at Day 2 · 0:00:00"


def test_the_seam_is_found_with_the_fork_on_either_side():
    parent = run_row(id=1)
    fork = run_row(id=2, parentRunId=1, forkedAtTick=14_400)
    assert comparison_window(fork, parent)["fromTick"] == 14_400


def test_two_siblings_of_one_fork_share_their_parents_history():
    left = run_row(id=2, parentRunId=1, forkedAtTick=14_400)
    right = run_row(id=3, parentRunId=1, forkedAtTick=14_400)
    assert comparison_window(left, right)["fromTick"] == 14_400


def test_siblings_forked_at_different_ticks_share_nothing_measurable():
    left = run_row(id=2, parentRunId=1, forkedAtTick=14_400)
    right = run_row(id=3, parentRunId=1, forkedAtTick=28_800)
    assert comparison_window(left, right)["fromTick"] == 0


# --- the P&L ---------------------------------------------------------------


def test_the_five_net_effects_sum_to_the_net_delta():
    # The identity that makes the table trustworthy: the lines must add up to
    # the score's own difference, the same agree-by-construction rule the
    # engine holds between calculateThroughput and its per-part credits.
    baseline = metrics()
    variant = metrics(
        throughputCents=900_000,
        operatingExpenseCents=210_000,
        carryingCostCents=8_000,
        wageCents=100_000,
        capitalSpendCents=148_800,
        netCents=433_200,
    )
    lines = compare_pl(baseline, variant)
    assert len(lines) == len(PL_LINES)
    assert sum(line["netEffectCents"] for line in lines) == (
        variant["netCents"] - baseline["netCents"]
    )


def test_a_cost_that_rose_hurts_the_score():
    lines = compare_pl(metrics(), metrics(wageCents=100_000))
    wages = next(line for line in lines if line["line"] == "wageCents")
    assert wages["deltaCents"] == 50_000
    assert wages["netEffectCents"] == -50_000


def test_throughput_that_rose_helps_the_score():
    lines = compare_pl(metrics(), metrics(throughputCents=600_000))
    throughput = next(line for line in lines if line["line"] == "throughputCents")
    assert throughput["netEffectCents"] == 100_000


# --- the constraint --------------------------------------------------------


def test_the_constraint_is_the_busiest_centre_that_had_capacity():
    payload = metrics(
        flow={
            "meanWip": 1,
            "maxWip": 1,
            "finalWip": 1,
            "workCenters": [
                {
                    "workCenterId": 7,
                    "utilization": 0.5,
                    "busyMachineTicks": 1,
                    "capacityTicks": 2,
                },
                {
                    "workCenterId": 9,
                    "utilization": 0.9,
                    "busyMachineTicks": 9,
                    "capacityTicks": 10,
                },
            ],
        }
    )
    assert constraint_of(payload)["workCenterId"] == 9


def test_a_centre_retired_to_nothing_is_not_the_constraint():
    # No machines means no capacity-ticks and a reported utilization of 0; it
    # must not win the ranking by default, and there may be no constraint.
    payload = metrics(
        flow={
            "meanWip": 0,
            "maxWip": 0,
            "finalWip": 0,
            "workCenters": [
                {
                    "workCenterId": 7,
                    "utilization": 0,
                    "busyMachineTicks": 0,
                    "capacityTicks": 0,
                },
            ],
        }
    )
    assert constraint_of(payload) is None


# --- the whole verdict -----------------------------------------------------


def test_the_variant_wins_when_its_net_is_higher():
    verdict = compare(
        run_row(id=1),
        metrics(),
        run_row(id=2, name="two presses"),
        metrics(netCents=340_000, throughputCents=600_000),
    )
    assert verdict["winnerRunId"] == 2
    assert verdict["netDeltaCents"] == 100_000
    assert verdict["biggestMover"]["line"] == "throughputCents"
    assert "#2 two presses wins by $1,000.00" in verdict["summary"]


def test_the_baseline_wins_when_the_decision_lost_money():
    verdict = compare(
        run_row(id=1, name="control"),
        metrics(),
        run_row(id=2, name="bought a press"),
        metrics(netCents=91_200, capitalSpendCents=148_800),
    )
    assert verdict["winnerRunId"] == 1
    assert verdict["netDeltaCents"] == -148_800
    assert verdict["biggestMover"]["line"] == "capitalSpendCents"
    assert "#1 control wins by $1,488.00" in verdict["summary"]


def test_an_identical_pair_is_a_dead_heat_with_no_mover():
    # Two same-seed branches with no decision between them MUST come out
    # identical — the property `npm run check:fork` proves end to end. A
    # verdict that invented a winner here would be reporting the dice.
    verdict = compare(run_row(id=1), metrics(), run_row(id=2), metrics())
    assert verdict["winnerRunId"] is None
    assert verdict["netDeltaCents"] == 0
    assert verdict["biggestMover"] is None
    assert "Dead heat" in verdict["summary"]


def test_the_window_is_reported_from_the_response_not_the_request():
    # /metrics snaps a window to whole observation buckets, so the ticks it
    # answers for are the ticks the figures cover.
    verdict = compare(
        run_row(id=1),
        metrics(fromTick=14_400, toTick=57_600),
        run_row(id=2, parentRunId=1, forkedAtTick=14_430),
        metrics(fromTick=14_400, toTick=57_600),
    )
    assert verdict["window"] == {
        "fromTick": 14_400,
        "toTick": 57_600,
        "dayTicks": 28_800,
    }


def test_outcomes_carry_the_reasons_behind_the_delta():
    verdict = compare(
        run_row(id=1),
        metrics(),
        run_row(id=2),
        metrics(
            netCents=300_000,
            cycleTime={"count": 60, "meanSeconds": 600.0, "p95Seconds": 1200},
            onTimeDelivery={"measuredCount": 60, "onTimeFraction": 1.0},
            scrap={"scrappedCount": 5, "scrappedMaterialCents": 9_000},
        ),
    )
    outcomes = verdict["outcomes"]
    assert outcomes["finished"]["delta"] == 20
    assert outcomes["onTimeFraction"]["delta"] == pytest.approx(0.05)
    assert outcomes["meanCycleSeconds"]["delta"] == -300.0
    assert outcomes["scrappedCount"]["delta"] == 3


def test_an_unmeasured_promise_is_not_a_zero_difference():
    # A null on-time fraction means no finished unit carried a promise. "No
    # change" would be a claim about something neither run measured.
    verdict = compare(
        run_row(id=1),
        metrics(onTimeDelivery={"measuredCount": 0, "onTimeFraction": None}),
        run_row(id=2),
        metrics(onTimeDelivery={"measuredCount": 40, "onTimeFraction": 0.9}),
    )
    assert verdict["outcomes"]["onTimeFraction"]["delta"] is None
    assert verdict["outcomes"]["onTimeFraction"]["variant"] == 0.9


def test_the_verdict_line_names_the_mover_that_cost_the_score():
    lines = compare_pl(metrics(), metrics(wageCents=150_000))
    summary = verdict_line(
        run_row(id=1, name="control"),
        run_row(id=2, name="second shift"),
        -100_000,
        lines,
    )
    assert "wages moved the score most, cost $1,000.00" in summary


# --- the tool --------------------------------------------------------------


def mock_backend(monkeypatch, handler) -> None:
    transport = httpx.MockTransport(handler)

    def client() -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=transport, base_url="http://test")

    monkeypatch.setattr(sim_client, "_client", client)


async def test_unequal_ticks_are_refused_rather_than_compared(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/runs/1":
            return httpx.Response(200, json=run_row(id=1, tickNum=57_600))
        if request.url.path == "/api/runs/2":
            return httpx.Response(200, json=run_row(id=2, tickNum=28_800))
        raise AssertionError(f"metrics must not be read: {request.url.path}")

    mock_backend(monkeypatch, handler)
    with pytest.raises(ToolException) as caught:
        await compare_runs.ainvoke({"baseline_run_id": 1, "variant_run_id": 2})
    assert "Advance the behind one to match" in str(caught.value)


async def test_a_run_cannot_be_compared_with_itself(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=run_row(id=1))

    mock_backend(monkeypatch, handler)
    with pytest.raises(ToolException):
        await compare_runs.ainvoke({"baseline_run_id": 1, "variant_run_id": 1})


async def test_the_tool_windows_both_runs_on_the_same_ticks(monkeypatch):
    asked: list[tuple[str, str | None, str | None]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/api/runs/1":
            return httpx.Response(200, json=run_row(id=1))
        if path == "/api/runs/2":
            return httpx.Response(
                200, json=run_row(id=2, parentRunId=1, forkedAtTick=28_800)
            )
        asked.append(
            (
                path,
                request.url.params.get("fromTick"),
                request.url.params.get("toTick"),
            )
        )
        return httpx.Response(200, json=metrics(fromTick=28_800, toTick=57_600))

    mock_backend(monkeypatch, handler)
    result = await compare_runs.ainvoke({"baseline_run_id": 1, "variant_run_id": 2})
    assert asked == [
        ("/api/runs/1/metrics", "28800", "57600"),
        ("/api/runs/2/metrics", "28800", "57600"),
    ]
    verdict = json.loads(result)
    assert verdict["window"]["basis"] == "since the fork at Day 2 · 0:00:00"
    assert verdict["window"]["forkedAtTick"] == 28_800
    assert verdict["netDeltaCents"] == 0
