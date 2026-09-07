"""The eval suite's own logic — matching, ground truth, dispatch. Pure."""

import pytest

from factory_agent.evals.answers import (
    mentions_any,
    mentions_dollars,
    mentions_number,
    mentions_text,
)
from factory_agent.evals.dataset import (
    best_run,
    build_examples,
    constraint_center,
    correctness,
    policy_forms,
)


class TestAnswerMatching:
    def test_number_matches_through_formatting(self):
        assert mentions_number("There are 12 runs", 12)
        assert mentions_number("Run #59 leads", 59)
        assert mentions_number("totals 3,718 units", 3718)

    def test_number_does_not_match_inside_another(self):
        assert not mentions_number("tick 120 of the run", 12)
        assert not mentions_number("about 3.5 days", 3)

    def test_dollars_accepts_the_shapes_prose_uses(self):
        assert mentions_dollars("netted $19,993.00 overall", 1999300)
        assert mentions_dollars("net profit of 19993 dollars", 1999300)
        assert mentions_dollars("that is 1999300 cents", 1999300)
        assert mentions_dollars("a loss of $506.27", -50627)
        assert not mentions_dollars("made $20,000", 1999300)

    def test_text_and_any_text(self):
        assert mentions_text("the Cutter is the constraint", "cutter")
        assert mentions_any("I'm read-only here", ["cannot", "read-only"])
        assert not mentions_any("done, bought it", ["cannot", "read-only"])


class TestGroundTruth:
    def test_best_run_is_argmax_net_with_id_tiebreak(self):
        summaries = [
            {"id": 1, "netCents": 100},
            {"id": 2, "netCents": 300},
            {"id": 3, "netCents": 300},
        ]
        assert best_run(summaries)["id"] == 2

    def test_best_run_refuses_an_empty_sim(self):
        with pytest.raises(ValueError):
            best_run([])

    def test_constraint_is_argmax_utilization_named_via_floor(self):
        metrics = {
            "flow": {
                "workCenters": [
                    {"workCenterId": 1, "utilization": 0.42},
                    {"workCenterId": 2, "utilization": 0.96},
                ]
            }
        }
        floor = {
            "workCenters": [
                {"workCenterId": 1, "name": "Drill Press"},
                {"workCenterId": 2, "name": "Cutter"},
            ]
        }
        top = constraint_center(metrics, floor)
        assert top["name"] == "Cutter"
        assert top["utilization"] == 0.96

    def test_policy_forms_speak_prose(self):
        assert "due date" in policy_forms("due_date")
        assert "drum-buffer-rope" in policy_forms("dbr")

    def test_build_examples_covers_the_suite(self):
        summaries = [
            {"id": 5, "name": "Base", "netCents": 100, "releasePolicy": "conwip"},
        ]
        metrics = {"flow": {"workCenters": [{"workCenterId": 1, "utilization": 0.9}]}}
        floor = {"workCenters": [{"workCenterId": 1, "name": "Cutter"}]}
        orders = [{"quantity": 10}, {"quantity": 20}]
        examples = build_examples(
            [{"id": 5}], summaries, metrics, floor, orders
        )
        assert len(examples) == 7
        by_check = [example["outputs"]["check"] for example in examples]
        assert by_check.count("any_text") == 2  # policy + read-only refusal
        numbers = next(e for e in examples if e["outputs"]["check"] == "numbers")
        assert numbers["outputs"]["values"] == [2, 30]


class TestCorrectnessDispatch:
    def score(self, answer: str, reference: dict) -> int:
        return correctness({}, {"answer": answer}, reference)["score"]

    def test_each_check_kind(self):
        assert self.score("6 runs exist", {"check": "number", "value": 6}) == 1
        assert self.score("Run #59 (Second press)", {"check": "run", "runId": 59}) == 1
        assert (
            self.score("$19,993.00 net", {"check": "dollars", "cents": 1999300}) == 1
        )
        assert self.score("the Cutter", {"check": "text", "value": "Cutter"}) == 1
        assert (
            self.score(
                "29 orders totalling 3,718 units",
                {"check": "numbers", "values": [29, 3718]},
            )
            == 1
        )
        assert (
            self.score(
                "I'm read-only, so no",
                {"check": "any_text", "values": ["read-only", "cannot"]},
            )
            == 1
        )

    def test_wrong_answers_score_zero(self):
        assert self.score("7 runs", {"check": "number", "value": 6}) == 0
        assert (
            self.score(
                "29 orders", {"check": "numbers", "values": [29, 3718]}
            )
            == 0
        )

    def test_unknown_check_raises(self):
        with pytest.raises(ValueError):
            self.score("x", {"check": "nope"})
