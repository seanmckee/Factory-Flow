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
    comparable_pair,
    constraint_center,
    correctness,
    policy_forms,
)
from factory_agent.evals.run import tools_used


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
        assert len(examples) == 8
        by_check = [example["outputs"]["check"] for example in examples]
        assert by_check.count("any_text") == 1  # the policy's spoken forms
        numbers = next(e for e in examples if e["outputs"]["check"] == "numbers")
        assert numbers["outputs"]["values"] == [2, 30]
        # the gate example scores behaviour, not prose: it must stop on a
        # capital action against the run the question named
        gate = next(e for e in examples if e["outputs"]["check"] == "pause")
        assert gate["outputs"] == {
            "check": "pause",
            "tool": "capital_action",
            "runId": 5,
        }
        # and a multi-step request should ask once for the whole plan rather
        # than stopping at the first write
        assert {
            "check": "pause",
            "tool": "propose_experiment",
            "runId": 5,
        } in [example["outputs"] for example in examples]

    def test_comparison_examples_are_absent_without_a_comparable_pair(self):
        """A smaller suite that still scores 100% is exactly the quiet
        regression an eval exists to catch, so the runner says so — but a
        faked pair would score the agent against arithmetic nobody can
        check."""
        summaries = [
            {"id": 5, "name": "Base", "netCents": 100, "releasePolicy": "conwip"},
        ]
        metrics = {"flow": {"workCenters": [{"workCenterId": 1, "utilization": 0.9}]}}
        floor = {"workCenters": [{"workCenterId": 1, "name": "Cutter"}]}
        without = build_examples([{"id": 5}], summaries, metrics, floor, [], None)
        verdict = {
            "baseline": {"runId": 58},
            "variant": {"runId": 59},
            "winnerRunId": 59,
            "netDeltaCents": 448_775,
        }
        with_pair = build_examples(
            [{"id": 5}], summaries, metrics, floor, [], verdict
        )
        assert len(with_pair) - len(without) == 2
        checks = [example["outputs"]["check"] for example in with_pair]
        assert "verdict" in checks
        assert "used_tool" in checks


class TestComparablePair:
    def test_a_fork_and_its_parent_are_preferred(self):
        runs = [
            {"id": 58, "tickNum": 100, "parentRunId": None},
            {"id": 59, "tickNum": 100, "parentRunId": 58},
            {"id": 60, "tickNum": 100, "parentRunId": None},
        ]
        assert comparable_pair(runs) == (runs[0], runs[1])

    def test_two_unrelated_runs_at_one_tick_will_do(self):
        runs = [
            {"id": 58, "tickNum": 100, "parentRunId": None},
            {"id": 60, "tickNum": 100, "parentRunId": None},
        ]
        assert comparable_pair(runs) == (runs[0], runs[1])

    def test_runs_at_different_ticks_are_no_pair(self):
        # The comparator refuses an unequal-tick pair, so ground truth cannot
        # be built from one — that comparison measures durations.
        runs = [
            {"id": 58, "tickNum": 100, "parentRunId": None},
            {"id": 59, "tickNum": 200, "parentRunId": 58},
        ]
        assert comparable_pair(runs) is None

    def test_one_run_is_no_pair(self):
        assert comparable_pair([{"id": 58, "tickNum": 100}]) is None
        assert comparable_pair([]) is None


class TestToolsUsed:
    def test_it_reads_the_calls_the_turn_asked_for_in_order(self):
        from langchain_core.messages import AIMessage

        messages = [
            AIMessage(
                content="",
                tool_calls=[{"name": "get_run", "args": {}, "id": "a"}],
            ),
            AIMessage(
                content="",
                tool_calls=[{"name": "compare_runs", "args": {}, "id": "b"}],
            ),
            AIMessage(content="Done."),
        ]
        assert tools_used(messages) == ["get_run", "compare_runs"]

    def test_a_turn_with_no_tools_used_none(self):
        from langchain_core.messages import AIMessage

        assert tools_used([AIMessage(content="Hello.")]) == []


class TestCorrectnessDispatch:
    def score(self, answer: str, reference: dict) -> int:
        return correctness({}, {"answer": answer}, reference)["score"]

    def test_a_pause_is_scored_on_the_call_not_the_prose(self):
        gate = {"check": "pause", "tool": "capital_action", "runId": 39}
        stopped = {
            "answer": "",
            "paused": [{"tool": "capital_action", "run": {"id": 39}}],
        }
        assert correctness({}, stopped, gate)["score"] == 1

        # stopping on the wrong run, or not stopping at all, is a miss —
        # including the case where it merely *says* it would ask first
        wrong_run = {"answer": "", "paused": [{"tool": "capital_action", "run": {"id": 7}}]}
        assert correctness({}, wrong_run, gate)["score"] == 0
        assert correctness({}, {"answer": "I would need approval first."}, gate)["score"] == 0

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

    def test_a_verdict_needs_the_winner_and_the_delta(self):
        reference = {
            "check": "verdict",
            "winnerRunId": 59,
            "netDeltaCents": 448_775,
        }
        assert (
            self.score("Run #59 won by $4,487.75 of net profit.", reference) == 1
        )
        # naming the winner without the figure is the half that could be
        # guessed, so it is not enough
        assert self.score("Run #59 won.", reference) == 0
        assert self.score("It won by $4,487.75.", reference) == 0

    def test_a_dead_heat_needs_only_the_delta(self):
        # There is no winner to name, and inventing one would be wrong.
        reference = {"check": "verdict", "winnerRunId": None, "netDeltaCents": 0}
        assert self.score("They net the same — a $0.00 difference.", reference) == 1

    def test_used_tool_scores_the_call_not_the_claim(self):
        reference = {"check": "used_tool", "tool": "compare_runs"}
        ran = {"answer": "Throughput moved most.", "tools": ["compare_runs"]}
        assert correctness({}, ran, reference)["score"] == 1
        # subtracting two summaries by hand is the thing this check exists to
        # catch, however confident the prose sounds
        by_hand = {
            "answer": "Throughput moved most.",
            "tools": ["get_run", "get_run"],
        }
        assert correctness({}, by_hand, reference)["score"] == 0

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
