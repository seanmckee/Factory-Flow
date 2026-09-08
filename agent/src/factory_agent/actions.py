"""The agent's write tools — the five verbs that change a run.

Deliberately its own module beside the read-only `tools.py`. The read/write
line is the one boundary in this service worth seeing in the file tree, and
`ACTION_TOOLS` is the list the graph treats differently: every call to a tool
in here pauses for human approval before it executes (see `agent.py`).

What they are NOT is privileged. Every one is an HTTP POST the browser could
make: the backend takes the run's lock, charges the run's own frozen prices
and returns the same 409 it would return to anyone. The agent inherits the
sim's rules rather than being trusted to follow them.
"""

import json

from langchain_core.tools import ToolException, tool

from . import sim_client
from .control import emit_progress, stop_requested

#: The backend caps one advance request; a run is resumable, so a longer jump
#: is simply more calls. Mirrors MAX_TICKS_PER_REQUEST in the API's schemas.
MAX_TICKS_PER_REQUEST = 20000


def _compact(payload: object) -> str:
    return json.dumps(payload, separators=(",", ":"))


@tool
async def fork_run(run_id: int, name: str | None = None) -> str:
    """Copy a run at its current tick into a new run, and return the new run.

    This is how you test a decision. The fork shares the parent's seed, frozen
    config and history up to forkedAtTick, so the two branches replay
    identically until a decision diverges them — which is what makes the
    difference in their netCents worth one decision rather than worth the
    dice. Act on the FORK and leave the parent as the control.

    Omit `name` and the backend names it after the parent plus the fork day.
    Returns the new run's row, including its `id` — use that id from then on.
    """
    body: dict = {} if name is None else {"name": name}
    return _compact(await sim_client.post_json(f"/api/runs/{run_id}/fork", body))


@tool
async def advance_run(run_id: int, ticks: int) -> str:
    """Run the simulation forward by `ticks` staffed seconds (max 20000 per
    call; call again to go further — a run is resumable and picks up exactly
    where it stopped).

    Returns the new tickNum, the money accrued during the advance, the
    surviving wipCount, scrappedCount, whatever the run's release policy put
    on the floor (autoReleased) and the backlogCount still releasable. It does
    NOT return netCents — read get_run for the score after advancing.

    To compare two branches fairly, advance both to the same tickNum.
    """
    return _compact(
        await sim_client.post_json(f"/api/runs/{run_id}/advance", {"ticks": ticks})
    )


@tool
async def advance_to_tick(run_id: int, to_tick: int) -> str:
    """Advance a run all the way to an absolute tick, in as many requests as
    that takes. Use this rather than calling advance_run in a loop.

    Give the TARGET tick, not a duration. That is what makes a fair comparison
    fair by construction: advance both branches to the same to_tick and they
    have run for the same time whatever state each was in. A run's dayTicks
    ticks make one calendar day, so day N ends at N * dayTicks.

    It can take minutes for a long jump and reports progress as it goes. A
    human can stop it; if they do, the run keeps every tick it committed and
    the result says where it stopped, which is a real answer and not a
    failure — advancing is resumable, so calling again continues from there.

    Returns the tick reached, the money accrued over the whole advance, the
    surviving wipCount, scrappedCount, everything the run's release policy put
    on the floor, the releasable backlogCount, and how many requests it took.
    A floor that empties does NOT stop it: rent and wages accrue against time,
    and an idle factory losing money is a finding, not a reason to stop.
    """
    run = await sim_client.get_json(f"/api/runs/{run_id}")
    if not isinstance(run, dict):
        raise ToolException(f"the backend did not return run {run_id}")
    start = int(run["tickNum"])
    if to_tick <= start:
        raise ToolException(
            f"run {run_id} is already at tick {start}, so it cannot advance to "
            f"{to_tick}. A run only moves forward; re-creating it from its seed "
            "is how you get an earlier tick back."
        )

    totals = {
        "throughputCents": 0,
        "operatingExpenseCents": 0,
        "carryingCostCents": 0,
        "wageCents": 0,
        "scrappedCount": 0,
    }
    auto_released: list[dict] = []
    tick = start
    requests = 0
    stopped = False
    # Seeded from the summary so a stop that lands before the first chunk
    # still reports the floor honestly. The backlog is not on a summary — it
    # is read per advance — so it stays unknown until one happens, which is
    # the truth rather than a zero.
    last: dict = {"wipCount": run.get("wipCount")}

    while tick < to_tick:
        if stop_requested():
            stopped = True
            break
        step = min(to_tick - tick, MAX_TICKS_PER_REQUEST)
        result = await sim_client.post_json(
            f"/api/runs/{run_id}/advance", {"ticks": step}
        )
        requests += 1
        for key in totals:
            totals[key] += result.get(key, 0)
        auto_released.extend(result.get("autoReleased") or [])
        tick = int(result["tickNum"])
        last = result
        emit_progress(
            {
                "tool": "advance_to_tick",
                "runId": run_id,
                "tickNum": tick,
                "fromTick": start,
                "toTick": to_tick,
                # the run's own staffed day, so a watcher can read the tick as
                # calendar time without guessing at shifts
                "dayTicks": run.get("dayTicks"),
                "wipCount": result.get("wipCount"),
            }
        )

    return _compact(
        {
            "runId": run_id,
            "tickNum": tick,
            "fromTick": start,
            "requestedToTick": to_tick,
            "ticksAdvanced": tick - start,
            "requests": requests,
            # a stop is a real outcome: the run kept every committed tick
            "stopped": stopped,
            **totals,
            "wipCount": last.get("wipCount"),
            "backlogCount": last.get("backlogCount"),
            "autoReleased": auto_released,
        }
    )


@tool
async def capital_action(run_id: int, kind: str, work_center_id: int) -> str:
    """Buy or retire a machine, or hire or let go of an operator, at one work
    center in one run. `kind` is exactly one of: buy_machine, retire_machine,
    hire_operator, fire_operator.

    You do not set the price: the run pays its OWN frozen price, so a price
    edited in the factory after the run started changes nothing here. The
    charge lands as a lump at the current tick and pushes netCents down until
    the decision earns it back — that payback is the thing worth measuring.

    Effective capacity is min(machines, operators), so a machine with nobody
    at it adds nothing but rent. Returns the spendCents charged (negative for
    salvage on a retirement) and the machine/operator counts afterwards.
    """
    return _compact(
        await sim_client.post_json(
            f"/api/runs/{run_id}/actions",
            {"kind": kind, "workCenterId": work_center_id},
        )
    )


@tool
async def set_release_policy(
    run_id: int,
    release_policy: str,
    wip_cap: int | None = None,
    release_lead_days: int | None = None,
    drum_work_center_id: int | None = None,
    drum_buffer: int | None = None,
    clear_drum: bool = False,
) -> str:
    """Change how a run feeds its own floor while it advances, effective from
    the next advance. `release_policy` is one of: manual, conwip, due_date,
    dbr (drum-buffer-rope). Priority is earliest-due-date throughout.

    Omitted numbers keep the run's current values. The drum is three-way:
    leave `drum_work_center_id` out to keep the run's current drum, pass an id
    to set it, or pass `clear_drum=true` to remove it (a separate flag because
    "keep" and "clear" are different requests, and both look like an absent
    number). A dbr policy needs a drum that exists in THIS run's frozen
    config.

    Changing a policy costs nothing and is not logged as a capital action — it
    moves no money, only what goes onto the floor and when.
    """
    body: dict = {"releasePolicy": release_policy}
    if wip_cap is not None:
        body["wipCap"] = wip_cap
    if release_lead_days is not None:
        body["releaseLeadDays"] = release_lead_days
    if clear_drum:
        body["drumWorkCenterId"] = None
    elif drum_work_center_id is not None:
        body["drumWorkCenterId"] = drum_work_center_id
    if drum_buffer is not None:
        body["drumBuffer"] = drum_buffer
    return _compact(await sim_client.post_json(f"/api/runs/{run_id}/policy", body))


@tool
async def release_work_order(run_id: int, work_order_id: int) -> str:
    """Put one work order's units onto a run's floor by hand, at the current
    tick, pinning its routing steps as they stand right now.

    Mostly for a run on the `manual` policy; under any other policy the run
    releases from the backlog itself and a manual release is an extra on top.
    A work order can be released into a given run only once — a second attempt
    is a conflict, not a second batch.
    """
    return _compact(
        await sim_client.post_json(
            f"/api/runs/{run_id}/releases", {"workOrderId": work_order_id}
        )
    )


@tool
async def propose_experiment(
    purpose: str,
    run_ids: list[int],
    verbs: list[str],
    to_tick: int | None = None,
    max_spend_cents: int = 0,
) -> str:
    """Ask a human to approve a whole experiment up front, instead of
    approving each change one at a time. Call this FIRST when you intend to
    take more than one action.

    Say what you are testing (`purpose`), which runs you will touch
    (`run_ids` — include the control, even though you will not act on it),
    which verbs you need (`verbs`: fork_run, advance_to_tick, capital_action,
    set_release_policy, release_work_order), how far you will advance
    (`to_tick`, an absolute tick — omit it if you will not advance), and the
    most it may spend (`max_spend_cents`, 0 if the plan buys nothing).

    Ask for the least that does the job. Everything inside the plan then runs
    without stopping; anything outside it — another run, a verb you did not
    ask for, a longer advance, a bigger charge — stops and asks, so a plan
    that is too small costs one extra question and a plan that is too large
    asks a person to approve power you did not need.

    A fork's CHILD is not covered by the plan that created it: its id does not
    exist yet, so name the runs you already know and expect one more pause
    when you act on the new branch.
    """
    # The approval gate answers this call: its entire effect is the pause and
    # the grant, so there is nothing to execute. Reaching this body means the
    # routing that sends it to the gate is broken, which should be loud rather
    # than laundered into the transcript as a fact about the factory.
    raise RuntimeError(
        "propose_experiment reached its tool body; the approval gate should "
        "have answered it"
    )


#: Every verb the agent has. The graph pauses on each of these by name.
ACTION_TOOLS = [
    fork_run,
    advance_run,
    advance_to_tick,
    capital_action,
    set_release_policy,
    release_work_order,
]

ACTION_TOOL_NAMES = frozenset(verb.name for verb in ACTION_TOOLS)

#: Not a verb — it changes nothing in the sim — but it must still reach the
#: approval gate, because what it asks for is authority. Kept out of
#: ACTION_TOOLS so it is not itself something a plan can grant, and named here
#: so the graph's routing has one place to look.
PROPOSE_TOOL = propose_experiment
PROPOSE_TOOL_NAME = propose_experiment.name

#: Everything that must pass the gate: the verbs, plus the request for
#: authority over them.
GATED_TOOL_NAMES = ACTION_TOOL_NAMES | {PROPOSE_TOOL_NAME}
