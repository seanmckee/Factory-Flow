"""What a human is shown before a write executes.

The gate's whole value is in this module. A model that wants to buy a machine
can say anything it likes about which run that is; what you approve against is
what the **sim** says — the run's name, its tick, the centre's name and the
run's own frozen price, all fetched here at approval time. So the payload is
built from `GET /api/runs/:id` (and `/floor` when money is involved), never
from the model's own words.

The formatting is pure and tested; only `build_approval` touches the network.
"""

from typing import Any

from . import sim_client
from .sim_client import SimApiError

TICKS_PER_HOUR = 3600

#: Mirrors the backend cap, so the card can say how many requests a jump is —
#: the number that used to be the number of approvals.
MAX_TICKS_PER_REQUEST = 20000


def format_dollars(cents: int) -> str:
    """Cents as money, signed. Salvage comes back negative."""
    sign = "-" if cents < 0 else ""
    magnitude = abs(cents)
    return f"{sign}${magnitude // 100:,}.{magnitude % 100:02d}"


def format_tick(tick: int, day_ticks: int) -> str:
    """A tick as staffed calendar time — the same convention as the frontend's
    formatTickTime, where tick 0 is the start of Day 1."""
    if day_ticks <= 0:
        return f"tick {tick}"
    day = tick // day_ticks + 1
    within = tick % day_ticks
    return f"Day {day} · {within // 3600}:{within // 60 % 60:02d}:{within % 60:02d}"


def format_span(ticks: int, day_ticks: int) -> str:
    """A duration in the units a person schedules in. Ticks are staffed
    seconds, so a 'day' here is the run's staffed day, not 24h."""
    if day_ticks > 0 and ticks >= day_ticks:
        days = ticks / day_ticks
        return f"{days:.2g} staffed day{'' if days == 1 else 's'}"
    if ticks >= TICKS_PER_HOUR:
        hours = ticks / TICKS_PER_HOUR
        return f"{hours:.2g} staffed hour{'' if hours == 1 else 's'}"
    return f"{ticks} staffed second{'' if ticks == 1 else 's'}"


CAPITAL_VERBS = {
    "buy_machine": "Buy a machine",
    "retire_machine": "Retire a machine",
    "hire_operator": "Hire an operator",
    "fire_operator": "Let an operator go",
}


def describe(name: str, args: dict, run: dict, center: dict | None) -> str:
    """One line a person can approve or refuse, in the sim's own vocabulary.

    `run` is the authoritative summary; `center` is the frozen work-centre row
    off the floor, present only for a capital action.
    """
    day_ticks = run.get("dayTicks") or 0
    at = format_tick(run.get("tickNum") or 0, day_ticks)

    if name == "fork_run":
        named = args.get("name")
        suffix = f", named “{named}”" if named else ""
        return f"Fork this run at {at} into a new run{suffix}"

    if name == "advance_run":
        ticks = int(args.get("ticks") or 0)
        end = format_tick((run.get("tickNum") or 0) + ticks, day_ticks)
        return (
            f"Advance {format_span(ticks, day_ticks)} — {at} → {end}. "
            "Rent, wages and carrying accrue the whole way."
        )

    if name == "advance_to_tick":
        target = int(args.get("to_tick") or 0)
        current = int(run.get("tickNum") or 0)
        ticks = max(0, target - current)
        requests = -(-ticks // MAX_TICKS_PER_REQUEST)  # ceiling division
        return (
            f"Advance to {format_tick(target, day_ticks)} — "
            f"{format_span(ticks, day_ticks)} from {at}, in {requests} "
            f"request{'' if requests == 1 else 's'}. Rent, wages and carrying "
            "accrue the whole way, and it can be stopped part-way."
        )

    if name == "capital_action":
        verb = CAPITAL_VERBS.get(str(args.get("kind")), str(args.get("kind")))
        where = (
            center["name"] if center else f"work center {args.get('work_center_id')}"
        )
        if center is None:
            return f"{verb} at {where}, at {at}"
        price = capital_price(str(args.get("kind")), center)
        machines, operators = capital_effect(str(args.get("kind")), center)
        return (
            f"{verb} at {where} — {format_dollars(price)} at {at}. "
            f"Machines {center['machines']} → {machines}, "
            f"operators {center['operators']} → {operators}; "
            f"effective capacity is the lesser of the two."
        )

    if name == "set_release_policy":
        was = run.get("releasePolicy")
        now = args.get("release_policy")
        return f"Change the release policy from {was} to {now}, effective next advance"

    if name == "release_work_order":
        return f"Release work order #{args.get('work_order_id')} onto the floor at {at}"

    return f"{name} {args}"


def capital_price(kind: str, center: dict) -> int:
    """The run's own frozen price for one action. Salvage is money coming
    back, so it is negative — the same sign convention the capital log uses."""
    if kind == "buy_machine":
        return int(center.get("machinePurchaseCents") or 0)
    if kind == "retire_machine":
        return -int(center.get("machineSalvageCents") or 0)
    if kind == "hire_operator":
        return int(center.get("operatorHireCents") or 0)
    return 0  # letting someone go is free; the wage simply stops


def capital_effect(kind: str, center: dict) -> tuple[int, int]:
    """Machines and operators after the action."""
    machines = int(center.get("machines") or 0)
    operators = int(center.get("operators") or 0)
    if kind == "buy_machine":
        machines += 1
    elif kind == "retire_machine":
        machines = max(0, machines - 1)
    elif kind == "hire_operator":
        operators += 1
    elif kind == "fire_operator":
        operators = max(0, operators - 1)
    return machines, operators


async def build_approval(name: str, args: dict) -> dict[str, Any]:
    """The payload the human sees, or a refusal if the sim can't confirm it.

    Reads the run (and the floor, for a capital action) so the confirmation
    states the run's real name and the run's real price. A read that fails —
    a run id the model invented, a backend that is down — comes back as
    `{"error": ...}`: there is nothing to confirm, so the caller declines on
    the human's behalf rather than asking them to approve an unknown.
    """
    run_id = args.get("run_id")
    try:
        run = await sim_client.get_json(f"/api/runs/{run_id}")
        center = None
        if name == "capital_action":
            floor = await sim_client.get_json(f"/api/runs/{run_id}/floor")
            center = next(
                (
                    entry
                    for entry in floor["workCenters"]
                    if entry["workCenterId"] == args.get("work_center_id")
                ),
                None,
            )
            if center is None:
                return {
                    "error": (
                        f"Run {run_id} has no work center "
                        f"{args.get('work_center_id')}"
                    )
                }
    except SimApiError as error:
        return {"error": str(error)}

    assert isinstance(run, dict)
    return {
        "tool": name,
        "args": args,
        "run": {
            "id": run["id"],
            "name": run["name"],
            "tickNum": run["tickNum"],
            "status": run["status"],
            "netCents": run["netCents"],
            "isFork": run["parentRunId"] is not None,
        },
        "summary": describe(name, args, run, center),
    }
