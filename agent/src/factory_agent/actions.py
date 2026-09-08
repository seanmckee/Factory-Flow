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

from langchain_core.tools import tool

from . import sim_client

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


#: Every verb the agent has. The graph pauses on each of these by name.
ACTION_TOOLS = [
    fork_run,
    advance_run,
    capital_action,
    set_release_policy,
    release_work_order,
]

ACTION_TOOL_NAMES = frozenset(verb.name for verb in ACTION_TOOLS)
