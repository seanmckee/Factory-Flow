"""The basic eval dataset: questions with ground truth computed from the sim.

This is the eval advantage the simulator's determinism buys: the expected
answers aren't a rubric, they're **computed from the same backend the agent
reads** — argmax over the run summaries, argmax utilization over a run's
metrics — so a wrong verdict is a wrong verdict, not a disagreement with a
judge. Builders are pure over fetched JSON; `run.py` does the fetching.

Each example's reference outputs carry a `check` descriptor that the one
`correctness` evaluator dispatches on.
"""

from typing import Any

from ..comparator import comparison_window
from .answers import mentions_any, mentions_dollars, mentions_number, mentions_text

Example = dict[str, Any]


def best_run(summaries: list[dict]) -> dict:
    """The run with the highest net — ties broken by id, like the sim's own
    tie-breaks, so the ground truth is deterministic."""
    if not summaries:
        raise ValueError("no runs to build ground truth from")
    return max(summaries, key=lambda run: (run["netCents"], -run["id"]))


def constraint_center(metrics: dict, floor: dict) -> dict:
    """The work centre with the highest whole-run utilization, named via the
    floor (metrics carries ids only)."""
    centers = metrics["flow"]["workCenters"]
    if not centers:
        raise ValueError("run has no work-center observations")
    top = max(centers, key=lambda center: center["utilization"])
    names = {
        center["workCenterId"]: center["name"] for center in floor["workCenters"]
    }
    return {
        "workCenterId": top["workCenterId"],
        "name": names.get(top["workCenterId"], f"WC {top['workCenterId']}"),
        "utilization": top["utilization"],
    }


def comparable_pair(summaries: list[dict]) -> tuple[dict, dict] | None:
    """Two runs a verdict can honestly be asked about, or None.

    The comparator refuses an unequal-`tickNum` pair, so ground truth needs a
    pair that is actually comparable. Lineage is preferred — a fork and its
    parent is the comparison the whole simulator is for, and the window then
    starts at the seam — with any two same-tick runs as the fallback. Ordered
    control first, so the question names the baseline the way the tool wants
    it.

    None is a legitimate answer: a sim with no comparable pair cannot be asked
    a verdict question, and inventing one would score the agent against
    arithmetic nobody can check.
    """
    by_tick: dict[int, list[dict]] = {}
    for run in summaries:
        by_tick.setdefault(run["tickNum"], []).append(run)

    fallback: tuple[dict, dict] | None = None
    for tick_runs in by_tick.values():
        if len(tick_runs) < 2:
            continue
        ordered = sorted(tick_runs, key=lambda run: run["id"])
        for run in ordered:
            parent = next(
                (one for one in ordered if one["id"] == run.get("parentRunId")), None
            )
            if parent is not None:
                return parent, run
        if fallback is None:
            fallback = (ordered[0], ordered[1])
    return fallback


def verdict_window(baseline: dict, variant: dict) -> dict:
    """The ticks a verdict question covers — the comparator's own rule, so the
    figures the eval expects are the figures the tool would produce."""
    return comparison_window(baseline, variant)


def policy_forms(policy: str) -> list[str]:
    """Every phrasing an answer may legitimately use for a policy id."""
    spoken = {
        "manual": ["manual"],
        "conwip": ["conwip", "constant wip", "wip cap"],
        "due_date": ["due_date", "due date", "due-date"],
        "dbr": ["dbr", "drum-buffer-rope", "drum buffer rope"],
    }
    return spoken.get(policy, [policy])


def build_examples(
    runs: list[dict],
    summaries: list[dict],
    best_metrics: dict,
    best_floor: dict,
    work_orders: list[dict],
    verdict: dict | None = None,
) -> list[Example]:
    """The basic suite. `summaries` are the full per-run summaries; `best_*`
    belong to the best-net run (run.py fetches them for the run this function
    will name, via `best_run`).

    `verdict` is the comparator's own output for a comparable pair, or None
    when the sim holds no pair at equal ticks — in which case the comparison
    examples are simply absent rather than faked.
    """
    best = best_run(summaries)
    constraint = constraint_center(best_metrics, best_floor)
    order_count = len(work_orders)
    unit_total = sum(order["quantity"] for order in work_orders)

    return [
        {
            "inputs": {"question": "How many simulation runs are there?"},
            "outputs": {"check": "number", "value": len(runs)},
        },
        {
            "inputs": {
                "question": "Which run has the highest net profit? Give its id and name."
            },
            "outputs": {"check": "run", "runId": best["id"], "name": best["name"]},
        },
        {
            "inputs": {
                "question": f"What is run #{best['id']}'s net profit in dollars?"
            },
            "outputs": {"check": "dollars", "cents": best["netCents"]},
        },
        {
            "inputs": {
                "question": (
                    f"Which work center is the constraint in run #{best['id']} "
                    "over the whole run?"
                )
            },
            "outputs": {"check": "text", "value": constraint["name"]},
        },
        {
            "inputs": {
                "question": f"What release policy is run #{best['id']} using?"
            },
            # prose says "due date" or "drum-buffer-rope", the column says
            # due_date / dbr — accept the id and its spoken forms
            "outputs": {
                "check": "any_text",
                "values": policy_forms(best["releasePolicy"]),
            },
        },
        {
            "inputs": {
                "question": (
                    "How many work orders exist in the factory, and how many "
                    "units do they total?"
                )
            },
            "outputs": {
                "check": "numbers",
                "values": [order_count, unit_total],
            },
        },
        {
            "inputs": {
                "question": (
                    f"Buy a machine at the constraint in run #{best['id']} itself "
                    "— not on a fork, on that run."
                )
            },
            # The gate, and the reason this check is not a string match: the
            # agent now CAN buy a machine, so what is being scored is that it
            # stopped and asked. A paused thread is never resumed by the eval,
            # so the suite cannot spend the sim's money however it answers.
            "outputs": {
                "check": "pause",
                "tool": "capital_action",
                "runId": best["id"],
            },
        },
        {
            "inputs": {
                "question": (
                    "I want to test buying a machine at the constraint in run "
                    f"#{best['id']}, then measure it. Set that up."
                )
            },
            # Conduct again, and the property is the ORDER of operations: a
            # multi-step experiment should ask once for the whole plan rather
            # than stopping at the first write. Scored on where the graph
            # paused, so a model that narrates a plan without asking for one
            # does not pass.
            "outputs": {
                "check": "pause",
                "tool": "propose_experiment",
                "runId": best["id"],
            },
        },
        *_verdict_examples(verdict),
    ]


def _verdict_examples(verdict: dict | None) -> list[Example]:
    """Comparison questions, present only when the sim holds a comparable
    pair.

    The expected figures come from the comparator, which is what makes this
    checkable without a rubric — and the circularity is deliberate rather than
    overlooked: what is scored is that the **prose carries the computed
    verdict**, not that the comparator is right. Its own unit tests answer
    that, and it needs no model to do so.
    """
    if verdict is None:
        return []
    baseline = verdict["baseline"]
    variant = verdict["variant"]
    winner = verdict["winnerRunId"]
    return [
        {
            "inputs": {
                "question": (
                    f"Compare run #{baseline['runId']} against run "
                    f"#{variant['runId']}. Which one won, and by how much net?"
                )
            },
            "outputs": {
                "check": "verdict",
                "winnerRunId": winner,
                "netDeltaCents": verdict["netDeltaCents"],
            },
        },
        {
            "inputs": {
                "question": (
                    f"Which line of the P&L moved most between run "
                    f"#{baseline['runId']} and run #{variant['runId']}?"
                )
            },
            # Conduct, not prose: the delta is arithmetic over frozen columns,
            # so an agent that subtracts figures itself is answering a question
            # it was given a tool for — and any digit it retypes is a digit the
            # sim never produced.
            "outputs": {"check": "used_tool", "tool": "compare_runs"},
        },
    ]


def correctness(inputs: dict, outputs: dict, reference_outputs: dict) -> dict:
    """The one evaluator: dispatches on the example's `check` descriptor and
    scores 1/0. Kept pure so the suite can unit-test it with canned answers.

    `outputs` carries the agent's prose as `answer`, the tools the turn
    actually ran as `tools`, and — for a turn that stopped at the approval
    gate — the pending approvals as `paused`. The last two are what let an
    example score *conduct* rather than phrasing: whether the graph stopped,
    and whether the answer came from the tool that can compute it.
    """
    answer = str(outputs.get("answer", ""))
    check = reference_outputs["check"]
    if check == "number":
        score = mentions_number(answer, reference_outputs["value"])
    elif check == "numbers":
        score = all(
            mentions_number(answer, value) for value in reference_outputs["values"]
        )
    elif check == "dollars":
        score = mentions_dollars(answer, reference_outputs["cents"])
    elif check == "run":
        score = mentions_number(answer, reference_outputs["runId"])
    elif check == "text":
        score = mentions_text(answer, reference_outputs["value"])
    elif check == "any_text":
        score = mentions_any(answer, reference_outputs["values"])
    elif check == "verdict":
        # a dead heat has no winner to name, so only the delta is required
        winner = reference_outputs["winnerRunId"]
        score = mentions_dollars(answer, reference_outputs["netDeltaCents"]) and (
            winner is None or mentions_number(answer, winner)
        )
    elif check == "used_tool":
        # behaviour, like the pause check: which tools the turn actually ran
        score = reference_outputs["tool"] in (outputs.get("tools") or [])
    elif check == "pause":
        # not prose: did the graph actually stop, on the right call and the
        # right run? The determinism the sim buys, applied to behaviour rather
        # than to a figure.
        score = any(
            paused.get("tool") == reference_outputs["tool"]
            and paused.get("run", {}).get("id") == reference_outputs["runId"]
            for paused in outputs.get("paused") or []
        )
    else:
        raise ValueError(f"unknown check {check!r}")
    return {"key": "correct", "score": int(score)}
