"""The verdict, computed rather than narrated.

Both runs' P&L is frozen columns and the sim is deterministic, so "which
branch won, by how much, and which line of the P&L moved" is arithmetic. It
is deliberately not the model's job: a subtraction a model performs is a
figure the sim never produced, and the one number an experiment exists to
report is exactly the one worth refusing to guess. So this module computes
the verdict, and the model's job shrinks to asking for it and interpreting it.

Everything except `compare_runs` is pure, so the verdict is unit-tested with
no LLM, no network and no database — the same pure/impure split `approval.py`
draws.

Two rules it **enforces** rather than requests. The prompt already tells the
model to advance both branches to the same tick; a rule in a prompt is a
suggestion, and a comparison of unequal ticks is a comparison of durations
dressed up as a comparison of decisions. So an unequal pair is refused here.
And when the pair is lineage, the window starts at the fork seam: before it
the two runs are byte-identical by construction, so including that history
only dilutes the delta with the money both branches earned together.
"""

import json
from typing import Any

from langchain_core.tools import ToolException, tool

from . import sim_client
from .approval import format_dollars, format_tick


def _compact(payload: object) -> str:
    return json.dumps(payload, separators=(",", ":"))


# The five lines and their sign against the score, in P&L order. Throughput
# adds; the four costs subtract. The sign is what makes a delta legible: "+$21
# of carrying cost" is *worse* for the variant, and a table that shows only
# the raw difference makes the reader do that flip five times.
PL_LINES: list[tuple[str, str, int]] = [
    ("throughputCents", "Throughput", 1),
    ("operatingExpenseCents", "Operating expense", -1),
    ("carryingCostCents", "Carrying cost", -1),
    ("wageCents", "Wages", -1),
    ("capitalSpendCents", "Capital spend", -1),
]


def _shared_seam(baseline: dict, variant: dict) -> int | None:
    """The tick at which the two histories stop being identical, or None if
    they never were. Parent/child in either direction, or two siblings of the
    same fork — everything else shares nothing."""
    if variant.get("parentRunId") == baseline["id"]:
        return variant.get("forkedAtTick")
    if baseline.get("parentRunId") == variant["id"]:
        return baseline.get("forkedAtTick")
    siblings = (
        baseline.get("parentRunId") is not None
        and baseline.get("parentRunId") == variant.get("parentRunId")
        and baseline.get("forkedAtTick") == variant.get("forkedAtTick")
    )
    return baseline.get("forkedAtTick") if siblings else None


def comparison_window(baseline: dict, variant: dict) -> dict[str, Any]:
    """The ticks the comparison is fair over, and why.

    A fork shares its parent's history up to `forkedAtTick`, and two siblings
    forked from one parent at one tick share it too — in both cases the money
    before the seam is identical on both sides and belongs to neither
    decision. Anything else (two independently created runs) is compared over
    its whole life, from tick 0: tick 0 is a real moment at which a capital
    action can already have spent money.

    `/metrics` snaps a window back to a whole observation bucket, so the
    measured window can begin up to a minute *before* the seam. That is
    harmless rather than sloppy: those ticks are shared history, identical on
    both sides by construction, so they contribute the same cents to each and
    cancel out of every delta. They inflate the two absolute columns
    fractionally, which is why the window is reported alongside them.
    """
    day_ticks = baseline.get("dayTicks") or variant.get("dayTicks") or 0
    seam = _shared_seam(baseline, variant)
    if seam is None:
        return {
            "fromTick": 0,
            "toTick": baseline["tickNum"],
            "basis": "whole run",
            "forkedAtTick": None,
        }
    return {
        "fromTick": seam,
        "toTick": baseline["tickNum"],
        "basis": f"since the fork at {format_tick(seam, day_ticks)}",
        "forkedAtTick": seam,
    }


def compare_pl(baseline: dict, variant: dict) -> list[dict[str, Any]]:
    """The five lines, each with its raw difference and its effect on the score.

    `netEffectCents` is the line's contribution to the net delta, which is
    what makes the table add up: the five net effects sum to
    `variant.netCents - baseline.netCents` by construction, the same
    agree-by-construction rule the engine holds between `calculateThroughput`
    and its per-part credits.
    """
    lines: list[dict[str, Any]] = []
    for key, label, sign in PL_LINES:
        before = baseline.get(key, 0)
        after = variant.get(key, 0)
        delta = after - before
        lines.append(
            {
                "line": key,
                "label": label,
                "baselineCents": before,
                "variantCents": after,
                "deltaCents": delta,
                "netEffectCents": sign * delta,
            }
        )
    return lines


def _delta(before: float | None, after: float | None) -> float | None:
    """A difference only where both sides measured something.

    None is not zero anywhere in this sim: a null on-time fraction means no
    finished unit carried a promise, and calling that a zero-point difference
    would report "no change" about a thing neither run measured.
    """
    if before is None or after is None:
        return None
    return after - before


def constraint_of(metrics: dict) -> dict[str, Any] | None:
    """The window's constraint: the highest-utilization centre that had any
    capacity at all. A centre retired to no machines contributes no
    capacity-ticks and reads 0, so it must not win by default; ties go to the
    lowest id so the answer is stable rather than dict-ordered.

    Only the id, because metrics carry ids and a run keeps no copy of the
    names — the caller resolves it through the floor, as the dashboard does.
    """
    centers = [
        center
        for center in metrics.get("flow", {}).get("workCenters", [])
        if center.get("capacityTicks", 0) > 0
    ]
    if not centers:
        return None
    best = max(
        centers, key=lambda center: (center["utilization"], -center["workCenterId"])
    )
    return {
        "workCenterId": best["workCenterId"],
        "utilization": best["utilization"],
        "busyMachineTicks": best["busyMachineTicks"],
        "capacityTicks": best["capacityTicks"],
    }


def compare_outcomes(baseline: dict, variant: dict) -> dict[str, Any]:
    """The non-money half of a verdict — the reasons a net delta came out the
    way it did. A decision that bought net by breaking every promise, or by
    piling up WIP, is a decision a report has to be able to name."""
    base_otd = baseline.get("onTimeDelivery", {})
    var_otd = variant.get("onTimeDelivery", {})
    base_cycle = baseline.get("cycleTime", {})
    var_cycle = variant.get("cycleTime", {})
    base_flow = baseline.get("flow", {})
    var_flow = variant.get("flow", {})
    base_scrap = baseline.get("scrap", {})
    var_scrap = variant.get("scrap", {})
    return {
        "finished": {
            "baseline": base_cycle.get("count", 0),
            "variant": var_cycle.get("count", 0),
            "delta": var_cycle.get("count", 0) - base_cycle.get("count", 0),
        },
        "onTimeFraction": {
            "baseline": base_otd.get("onTimeFraction"),
            "variant": var_otd.get("onTimeFraction"),
            "delta": _delta(
                base_otd.get("onTimeFraction"), var_otd.get("onTimeFraction")
            ),
            "baselineMeasured": base_otd.get("measuredCount", 0),
            "variantMeasured": var_otd.get("measuredCount", 0),
        },
        "meanCycleSeconds": {
            "baseline": base_cycle.get("meanSeconds"),
            "variant": var_cycle.get("meanSeconds"),
            "delta": _delta(
                base_cycle.get("meanSeconds"), var_cycle.get("meanSeconds")
            ),
        },
        "p95CycleSeconds": {
            "baseline": base_cycle.get("p95Seconds"),
            "variant": var_cycle.get("p95Seconds"),
            "delta": _delta(base_cycle.get("p95Seconds"), var_cycle.get("p95Seconds")),
        },
        "meanWip": {
            "baseline": base_flow.get("meanWip"),
            "variant": var_flow.get("meanWip"),
            "delta": _delta(base_flow.get("meanWip"), var_flow.get("meanWip")),
        },
        "maxWip": {
            "baseline": base_flow.get("maxWip"),
            "variant": var_flow.get("maxWip"),
            "delta": _delta(base_flow.get("maxWip"), var_flow.get("maxWip")),
        },
        "scrappedCount": {
            "baseline": base_scrap.get("scrappedCount", 0),
            "variant": var_scrap.get("scrappedCount", 0),
            "delta": var_scrap.get("scrappedCount", 0)
            - base_scrap.get("scrappedCount", 0),
        },
        "constraint": {
            "baseline": constraint_of(baseline),
            "variant": constraint_of(variant),
        },
    }


def biggest_mover(lines: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The line that moved the score most, which is the sentence a verdict
    actually wants: a purchase that pays back is capital spend down the net
    curve and throughput up it. Ignores lines that did not move, so an
    identical pair has no mover rather than an arbitrary one."""
    moved = [line for line in lines if line["netEffectCents"] != 0]
    if not moved:
        return None
    return max(moved, key=lambda line: abs(line["netEffectCents"]))


def compare(
    baseline_run: dict,
    baseline_metrics: dict,
    variant_run: dict,
    variant_metrics: dict,
) -> dict[str, Any]:
    """The whole verdict over one already-resolved window.

    The window bounds come from the **metrics responses**, not from what was
    requested: `/metrics` snaps a window to whole observation buckets, so the
    ticks it answers for are the ticks the figures cover, and a verdict that
    states a window it did not measure is the same lie a stale dashboard
    label tells.
    """
    lines = compare_pl(baseline_metrics, variant_metrics)
    baseline_net = baseline_metrics["netCents"]
    variant_net = variant_metrics["netCents"]
    net_delta = variant_net - baseline_net
    winner = None
    if net_delta > 0:
        winner = variant_run["id"]
    elif net_delta < 0:
        winner = baseline_run["id"]
    return {
        "baseline": {
            "runId": baseline_run["id"],
            "name": baseline_run["name"],
            "tickNum": baseline_run["tickNum"],
            "netCents": baseline_net,
        },
        "variant": {
            "runId": variant_run["id"],
            "name": variant_run["name"],
            "tickNum": variant_run["tickNum"],
            "netCents": variant_net,
        },
        "window": {
            "fromTick": baseline_metrics["fromTick"],
            "toTick": baseline_metrics["toTick"],
            "dayTicks": baseline_run.get("dayTicks"),
        },
        "winnerRunId": winner,
        "netDeltaCents": net_delta,
        "pl": lines,
        "biggestMover": biggest_mover(lines),
        "outcomes": compare_outcomes(baseline_metrics, variant_metrics),
        "summary": verdict_line(baseline_run, variant_run, net_delta, lines),
    }


def verdict_line(
    baseline_run: dict, variant_run: dict, net_delta: int, lines: list[dict[str, Any]]
) -> str:
    """One sentence, in the sim's own vocabulary rather than the model's.

    A dead heat is a real and expected result, not a missing answer: two
    same-seed branches with no decision between them must come out identical,
    which is the property `npm run check:fork` exists to prove.
    """
    variant_label = f"#{variant_run['id']} {variant_run['name']}"
    baseline_label = f"#{baseline_run['id']} {baseline_run['name']}"
    if net_delta == 0:
        return (
            f"Dead heat: {variant_label} and {baseline_label} net the same "
            "over this window."
        )
    winner, loser = (
        (variant_label, baseline_label)
        if net_delta > 0
        else (baseline_label, variant_label)
    )
    mover = biggest_mover(lines)
    moved = ""
    if mover is not None:
        direction = "gained" if mover["netEffectCents"] > 0 else "cost"
        moved = (
            f"; {mover['label'].lower()} moved the score most, "
            f"{direction} {format_dollars(abs(mover['netEffectCents']))}"
        )
    return (
        f"{winner} wins by {format_dollars(abs(net_delta))} of net profit "
        f"over {loser}{moved}."
    )


@tool
async def compare_runs(baseline_run_id: int, variant_run_id: int) -> str:
    """Compare two runs and return which one won, by how much, and which line
    of the P&L moved. Use this instead of subtracting figures yourself — the
    verdict is computed from the runs' frozen money columns.

    `baseline_run_id` is the CONTROL (the parent, if you forked) and
    `variant_run_id` the branch that took the decision. Both runs must be at
    the same tickNum: advance them there first, or this refuses, because a
    comparison of unequal ticks measures durations rather than decisions. When
    the pair is a fork and its parent (or two siblings of one fork), the
    window starts at the fork seam automatically, so the delta covers only the
    ticks the decision could affect.

    Returns the net delta in cents (positive = the variant won), the five P&L
    lines each with its effect on the score, the biggest mover, and the
    outcomes behind it: finished units, on-time fraction, cycle time, WIP,
    scrap and each side's constraint by work center id (resolve the name
    through get_run_floor).
    """
    baseline_run = await sim_client.get_json(f"/api/runs/{baseline_run_id}")
    variant_run = await sim_client.get_json(f"/api/runs/{variant_run_id}")
    if not isinstance(baseline_run, dict) or not isinstance(variant_run, dict):
        raise ToolException("the backend did not return two runs")
    if baseline_run["id"] == variant_run["id"]:
        raise ToolException(f"run {baseline_run['id']} cannot be compared with itself")
    if baseline_run["tickNum"] != variant_run["tickNum"]:
        raise ToolException(
            f"run {baseline_run['id']} is at tick {baseline_run['tickNum']} and run "
            f"{variant_run['id']} at tick {variant_run['tickNum']}. Advance the "
            "behind one to match before comparing, or the difference is a "
            "difference in how long they ran."
        )

    window = comparison_window(baseline_run, variant_run)
    params = {"fromTick": window["fromTick"], "toTick": window["toTick"]}
    baseline_metrics = await sim_client.get_json(
        f"/api/runs/{baseline_run_id}/metrics", params
    )
    variant_metrics = await sim_client.get_json(
        f"/api/runs/{variant_run_id}/metrics", params
    )
    verdict = compare(baseline_run, baseline_metrics, variant_run, variant_metrics)
    verdict["window"]["basis"] = window["basis"]
    verdict["window"]["forkedAtTick"] = window["forkedAtTick"]
    return _compact(verdict)


# A read, and a read by construction: the gate matches on `ACTION_TOOL_NAMES`,
# which is derived from `actions.py`, so a tool that changes nothing routes
# past the approval node without needing to be listed anywhere as safe.
COMPARATOR_TOOLS = [compare_runs]
