"""The analyst's read-only toolset.

Every tool is a GET against the backend and returns compact JSON text. The
docstrings are load-bearing: they are the tool descriptions the model plans
with, so they carry the domain semantics (money in cents, throughput = sales
money not parts, netCents is the score, utilization ranks the constraint).

Deliberately no write tools — advancing, releasing, buying, forking and
policy changes are a later phase. The authority boundary is structural: this
module simply holds no verb that changes anything.
"""

import json

from langchain_core.tools import tool

from . import sim_client


def _compact(payload: object) -> str:
    return json.dumps(payload, separators=(",", ":"))


def shape_floor(floor: dict) -> dict:
    """The floor snapshot without each machine's per-slot progress array —
    per-part noise the analyst never needs, on a payload read every question."""
    return {
        "tickNum": floor["tickNum"],
        "wipCount": floor["wipCount"],
        "workCenters": [
            {key: value for key, value in center.items() if key != "slots"}
            for center in floor["workCenters"]
        ],
    }


@tool
async def list_runs() -> str:
    """List every simulation run: id, name, current tick (one tick = one
    staffed second; dayTicks ticks make a calendar day), status, release
    policy, and lineage (parentRunId/forkedAtTick non-null for a fork).
    Start here to find which run the user means."""
    return _compact(await sim_client.get_json("/api/runs"))


@tool
async def get_run(run_id: int) -> str:
    """One run's summary and whole-run P&L. All money is integer cents.
    netCents = throughputCents - operatingExpenseCents - carryingCostCents -
    wageCents - capitalSpendCents; it is the run's score and can be negative.
    throughputCents is money made through sales, not parts produced. Also
    carries wipCount, finishedCount, the frozen policy, and releasedOrders."""
    return _compact(await sim_client.get_json(f"/api/runs/{run_id}"))


@tool
async def get_run_metrics(
    run_id: int, from_tick: int | None = None, to_tick: int | None = None
) -> str:
    """Rates over a tick window (omit bounds for the whole run): the P&L
    windowed, per-work-center utilization (busy machine-ticks / capacity-ticks
    — the highest utilization is the constraint), queue depths, WIP, cycle
    time, on-time delivery with a per-sales-order breakdown, and scrap.
    Always read utilization from here, never from a floor snapshot: the
    window matters (a centre can read 10% over a run and 52% over the ticks
    it was actually working)."""
    params: dict = {}
    if from_tick is not None:
        params["fromTick"] = from_tick
    if to_tick is not None:
        params["toTick"] = to_tick
    return _compact(
        await sim_client.get_json(f"/api/runs/{run_id}/metrics", params or None)
    )


@tool
async def get_run_floor(run_id: int) -> str:
    """A snapshot of the run's floor right now: parts at each work center,
    each centre's machines/operators (effective capacity is the lesser),
    frozen rates and capital prices. A snapshot, not a rate — use
    get_run_metrics for utilization."""
    floor = await sim_client.get_json(f"/api/runs/{run_id}/floor")
    return _compact(shape_floor(floor))


@tool
async def get_capital_log(run_id: int) -> str:
    """The run's capital actions (machines bought/retired, operators
    hired/fired): what each cost (spendCents is signed — salvage is negative)
    and the config it produced, with the tick it was applied."""
    return _compact(await sim_client.get_json(f"/api/runs/{run_id}/actions"))


@tool
async def list_work_orders() -> str:
    """The factory's work orders (supply side): part, routing, quantity, and
    allocations linking them to the sales orders they cover. Whether one is
    released is per run — read a run's releasedOrders for that."""
    return _compact(await sim_client.get_json("/api/work-orders"))


@tool
async def list_sales_orders() -> str:
    """The order book (demand side): part, quantity, unitPriceCents, dueDay
    (calendar day; null = no promise), and allocations. A finished unit earns
    unit price minus material cost only if an allocation covers it."""
    return _compact(await sim_client.get_json("/api/sales-orders"))


@tool
async def get_factory_settings() -> str:
    """The live facility defaults a NEW run would freeze: overhead per day,
    WIP carrying rate (basis points of on-floor material value per day),
    shifts, and the release-policy defaults. Existing runs keep their own
    frozen copies — read those off the run, not from here."""
    return _compact(await sim_client.get_json("/api/settings"))


ANALYST_TOOLS = [
    list_runs,
    get_run,
    get_run_metrics,
    get_run_floor,
    get_capital_log,
    list_work_orders,
    list_sales_orders,
    get_factory_settings,
]
