"""The rules of a granted experiment, pure and without a model.

Every assertion here is about authority, which is why none of them needs a
graph: `covers` decides, and its answer must be legible enough to put in
front of a person on the pause that follows.
"""

import pytest

from factory_agent.budget import (
    BUDGETABLE_VERBS,
    covers,
    new_budget,
    remaining_cents,
    spend,
)


def plan(**overrides):
    base = {
        "purpose": "test a second press",
        "run_ids": [58, 59],
        "verbs": ["advance_to_tick", "capital_action"],
        "to_tick": 230_400,
        "max_spend_cents": 200_000,
    }
    return new_budget(**{**base, **overrides})


class TestWithNoPlan:
    def test_nothing_is_covered_without_a_grant(self):
        # The default is the old behaviour: every write pauses.
        assert covers(None, "capital_action", {"run_id": 58}) is not None

    def test_the_reason_says_there_is_no_plan(self):
        assert "no experiment" in covers(None, "fork_run", {"run_id": 58})


class TestVerbs:
    def test_a_named_verb_is_covered(self):
        assert covers(plan(), "advance_to_tick", {"run_id": 58, "to_tick": 100}) is None

    def test_a_verb_the_plan_did_not_ask_for_still_pauses(self):
        # Approving advances is not approving purchases.
        reason = covers(plan(verbs=["advance_to_tick"]), "capital_action", {"run_id": 58})
        assert reason is not None
        assert "not capital_action" in reason

    def test_a_plan_cannot_grant_the_power_to_grant(self):
        assert "propose_experiment" not in BUDGETABLE_VERBS
        granted = plan(verbs=["propose_experiment", "fork_run"])
        assert granted["verbs"] == ["fork_run"]

    def test_a_plan_cannot_grant_a_relative_advance(self):
        # advance_run takes a duration, so the tick it lands on cannot be
        # checked against the plan's horizon without reading the run.
        assert "advance_run" not in BUDGETABLE_VERBS
        assert plan(verbs=["advance_run"])["verbs"] == []

    def test_a_verb_that_does_not_exist_is_dropped_not_fatal(self):
        assert plan(verbs=["fork_run", "sell_the_factory"])["verbs"] == ["fork_run"]


class TestRuns:
    def test_a_named_run_is_covered(self):
        assert covers(plan(), "capital_action", {"run_id": 59}) is None

    def test_another_run_still_pauses(self):
        # The control is the thing being measured against; a plan about a fork
        # must not quietly reach it.
        reason = covers(plan(), "capital_action", {"run_id": 61})
        assert reason is not None
        assert "#61" in reason and "#58, #59" in reason

    def test_a_call_with_no_run_is_judged_on_its_other_bounds(self):
        assert covers(plan(verbs=["fork_run"]), "fork_run", {}) is None


class TestHorizon:
    def test_an_advance_inside_the_horizon_is_covered(self):
        assert covers(plan(), "advance_to_tick", {"run_id": 58, "to_tick": 230_400}) is None

    def test_advancing_past_the_horizon_pauses(self):
        reason = covers(plan(), "advance_to_tick", {"run_id": 58, "to_tick": 230_401})
        assert reason is not None
        assert "230400" in reason

    def test_a_plan_with_no_horizon_covers_no_advancing(self):
        reason = covers(plan(to_tick=None), "advance_to_tick", {"run_id": 58, "to_tick": 1})
        assert reason is not None
        assert "does not cover advancing" in reason


class TestSpend:
    def test_a_charge_inside_the_ceiling_is_covered(self):
        assert covers(plan(), "capital_action", {"run_id": 58}, 148_800) is None

    def test_a_charge_over_the_ceiling_pauses(self):
        reason = covers(plan(max_spend_cents=100_000), "capital_action", {"run_id": 58}, 148_800)
        assert reason is not None
        assert "148800" in reason

    def test_spending_reduces_what_is_left(self):
        granted = spend(plan(), 148_800)
        assert granted["spentCents"] == 148_800
        assert remaining_cents(granted) == 51_200
        # and the next charge of the same size no longer fits
        assert covers(granted, "capital_action", {"run_id": 58}, 148_800) is not None

    def test_a_free_action_needs_no_ceiling(self):
        # Letting an operator go costs nothing; a plan that buys nothing can
        # still do it.
        assert covers(plan(max_spend_cents=0), "capital_action", {"run_id": 58}, 0) is None

    def test_spending_nothing_leaves_the_grant_alone(self):
        granted = plan()
        assert spend(granted, 0) == granted

    def test_a_negative_ceiling_is_no_ceiling_rather_than_a_credit(self):
        assert plan(max_spend_cents=-500)["maxSpendCents"] == 0


class TestGrantShape:
    def test_runs_are_deduplicated_and_ordered(self):
        assert plan(run_ids=[59, 58, 59])["runIds"] == [58, 59]

    def test_nothing_is_spent_at_the_start(self):
        assert plan()["spentCents"] == 0
        assert remaining_cents(plan()) == 200_000


@pytest.mark.parametrize(
    "verb", sorted(BUDGETABLE_VERBS)
)
def test_every_budgetable_verb_is_a_real_action(verb):
    """A plan must not be able to grant a verb that does not exist — the list
    would silently mean less than it says."""
    from factory_agent.actions import ACTION_TOOL_NAMES

    assert verb in ACTION_TOOL_NAMES
