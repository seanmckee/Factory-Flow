"""The plan paragraph a person grants or refuses, pure and without a model.

The model's `purpose` arrives in whatever shape it likes — a verb phrase, a
full sentence, a sentence with its own punctuation — and the card has to read
as English whichever it sends, because this is the sentence someone is
reading at the moment they hand over authority.
"""

from factory_agent.approval import describe_plan
from factory_agent.budget import new_budget

RUNS = [
    {"id": 76, "name": "Demo · baseline", "dayTicks": 28_800},
    {"id": 77, "name": "Demo · second press", "dayTicks": 28_800},
]


def plan(purpose: str):
    return new_budget(
        purpose=purpose,
        run_ids=[76, 77],
        verbs=["advance_to_tick", "capital_action"],
        to_tick=201_600,
        max_spend_cents=148_800,
    )


class TestPurpose:
    def test_a_verb_phrase_reads_as_a_sentence(self):
        text = describe_plan(plan("test a second press"), RUNS)
        assert text.startswith("Test a second press. ")

    def test_a_full_sentence_is_not_spliced_into_another(self):
        # What the model actually sends; this once rendered as
        # "To on Run #77 only, … comparison.: run an experiment …".
        text = describe_plan(
            plan("On Run #77 only, buy one Drill Press machine, then compare."),
            RUNS,
        )
        assert text.startswith("On Run #77 only, buy one Drill Press machine, then compare. ")
        assert "To on" not in text
        assert ".:" not in text

    def test_its_own_terminal_punctuation_is_kept_not_doubled(self):
        assert "worth it? " in describe_plan(plan("Is a second press worth it?"), RUNS)
        assert ".." not in describe_plan(plan("Test a press."), RUNS)

    def test_no_purpose_leaves_only_the_bounds(self):
        assert describe_plan(plan("  "), RUNS).startswith("Approving lets the agent")


class TestBounds:
    def test_states_runs_verbs_horizon_and_ceiling(self):
        text = describe_plan(plan("test a press"), RUNS)
        assert "#76 Demo · baseline, #77 Demo · second press" in text
        assert "advance_to_tick, capital_action" in text
        assert "Day 8 · 0:00:00" in text
        assert "$1,488.00" in text

    def test_ends_with_what_happens_outside_them(self):
        text = describe_plan(plan("test a press"), RUNS)
        assert text.endswith("Anything outside those bounds still asks you first.")
