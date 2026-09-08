"""Authority for a whole experiment, granted once.

The gate that came before this asked a human to approve every write. That is
the right *boundary* and the wrong *unit*: a two-branch experiment is a fork,
a decision, two advances and a comparison, and the advances alone used to be
44 requests. Chunking fixed the advances; this fixes the rest — the model
proposes the experiment, a person approves **that**, and the writes it
described then execute inside the bounds they approved.

What does not change is where authority comes from. A write still cannot
execute unless a human authorised it; the grant simply describes several
writes instead of one. And a budget can only ever *skip a pause it covers* —
anything outside its bounds falls through to the same interrupt as before, so
the failure mode of a wrong or stale grant is an extra question, never an
unapproved write.

The bounds are deliberately the four things that make an experiment
finite:

- **which runs** — a call against any other run re-pauses, so a plan about
  a fork cannot quietly touch the control it is measured against
- **which verbs** — approving advances is not approving purchases
- **a tick horizon** — the experiment ends somewhere
- **a spend ceiling** — in cents, checked against the **sim's** frozen price
  for each action, never against a number the model supplied

Pure, so every rule here is unit-tested without a model, a graph or a
network.
"""

from typing import Any, TypedDict


class Budget(TypedDict):
    """A granted plan, carried in the graph state and checkpointed with it."""

    purpose: str
    runIds: list[int]
    verbs: list[str]
    #: absolute tick the experiment may advance to; None = no advancing
    toTick: int | None
    maxSpendCents: int
    #: the sim's own quotes for what has been authorised so far under this grant
    spentCents: int


#: Verbs a plan may ask for.
#:
#: Two absences are deliberate. `propose_experiment` is not here because a
#: grant cannot grant the power to grant. And `advance_run` is not here
#: because it takes a *duration*: the tick it would land on depends on where
#: the run is now, which this module cannot read and must not guess, so it
#: could never be checked against the plan's horizon. `advance_to_tick`
#: states its target, which is the tool a planned experiment wants anyway —
#: two branches advanced to the same target have run the same time. A model
#: that asks for the relative one inside a plan simply gets the usual pause.
BUDGETABLE_VERBS = frozenset(
    {
        "fork_run",
        "advance_to_tick",
        "capital_action",
        "set_release_policy",
        "release_work_order",
    }
)


def new_budget(
    purpose: str,
    run_ids: list[int],
    verbs: list[str],
    to_tick: int | None,
    max_spend_cents: int,
) -> Budget:
    """A grant with nothing spent yet. Verbs outside `BUDGETABLE_VERBS` are
    dropped rather than rejected — a plan naming a tool that does not exist
    should be missing that power, not fail wholesale."""
    return Budget(
        purpose=purpose,
        runIds=sorted(set(run_ids)),
        verbs=sorted({verb for verb in verbs if verb in BUDGETABLE_VERBS}),
        toTick=to_tick,
        maxSpendCents=max(0, max_spend_cents),
        spentCents=0,
    )


def remaining_cents(budget: Budget) -> int:
    return max(0, budget["maxSpendCents"] - budget["spentCents"])


def covers(
    budget: Budget | None,
    name: str,
    args: dict[str, Any],
    spend_cents: int = 0,
) -> str | None:
    """None when this call is inside the grant, otherwise why it is not.

    A reason rather than a bare False, because the reason is what a person
    reads on the pause that follows: "this plan covers runs 58 and 59" is an
    answer; "not approved" is a shrug. `spend_cents` is the **sim's** quote
    for the call — the caller reads it off the approval payload, which is
    built from the run's own frozen prices.
    """
    if budget is None:
        return "no experiment has been approved"

    if name not in budget["verbs"]:
        allowed = ", ".join(budget["verbs"]) or "nothing"
        return f"the approved plan covers {allowed}, not {name}"

    run_id = args.get("run_id")
    if run_id is not None and int(run_id) not in budget["runIds"]:
        runs = ", ".join(f"#{one}" for one in budget["runIds"])
        return f"the approved plan covers {runs}, not #{int(run_id)}"

    # A fork creates a run the plan could not have named, so the *new* run is
    # outside every grant until a person says otherwise. That is the point:
    # forking is cheap, and what happens to the child is the experiment.
    horizon = budget["toTick"]
    target = _advance_target(name, args)
    if target is not None:
        if horizon is None:
            return "the approved plan does not cover advancing"
        if target > horizon:
            return f"the approved plan runs to tick {horizon}, not {target}"

    if spend_cents > 0 and spend_cents > remaining_cents(budget):
        return (
            f"it costs {spend_cents} cents and the approved plan has "
            f"{remaining_cents(budget)} of {budget['maxSpendCents']} left"
        )

    return None


def _advance_target(name: str, args: dict[str, Any]) -> int | None:
    """The absolute tick a call would advance to, or None if it is not an
    advance. Only `advance_to_tick` can answer this, which is exactly why it
    is the only advance a plan can grant."""
    if name != "advance_to_tick":
        return None
    target = args.get("to_tick")
    return int(target) if target is not None else None


def spend(budget: Budget, spend_cents: int) -> Budget:
    """The grant after authorising a charge.

    Counted at authorisation rather than after the fact, and therefore
    counted even if the backend then refuses the call with a 409. Over-
    counting a ceiling is the safe direction: the cost of being wrong is one
    extra question, and the alternative — reconciling against the run's
    capital log — cannot tell this experiment's spend from a spend the fork
    inherited from its parent.
    """
    if spend_cents <= 0:
        return budget
    return {**budget, "spentCents": budget["spentCents"] + spend_cents}
