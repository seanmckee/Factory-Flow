/**
 * A granted experiment, in words a person can check against what they meant.
 *
 * Pure and tested, like the verdict's transforms, and for the same reason:
 * these strings are what someone reads before handing over authority, and
 * what they read afterwards to see what is left of it. None of it recomputes
 * anything — the bounds come from the service, which built them from the sim.
 */
import type { AgentPlan } from "./sse";
import { formatMoneyCents } from "./verdictDisplay";
import { formatTickTime } from "../simulation/simTime";

/** What each verb lets the agent do, in the user's terms rather than the API's. */
const VERB_LABELS: Record<string, string> = {
  fork_run: "fork a run",
  advance_to_tick: "advance the clock",
  capital_action: "buy or retire machines and operators",
  set_release_policy: "change the release policy",
  release_work_order: "release work orders",
};

export function verbLabel(verb: string): string {
  return VERB_LABELS[verb] ?? verb;
}

/** Cents left of the ceiling. Never negative: a grant cannot go overdrawn,
 * because a charge that would exceed it pauses instead. */
export function remainingCents(plan: AgentPlan): number {
  return Math.max(0, plan.maxSpendCents - plan.spentCents);
}

/** How much of the ceiling is committed, in `[0, 1]` — 0 when there is no
 * ceiling at all, since a plan that buys nothing has nothing to fill. */
export function spentFraction(plan: AgentPlan): number {
  if (plan.maxSpendCents <= 0) return 0;
  return Math.min(1, plan.spentCents / plan.maxSpendCents);
}

export type PlanBound = { label: string; value: string };

/**
 * The bounds as rows, which is how they should be read: four separate limits,
 * each of which pauses on its own. One sentence hides that — and the sentence
 * is what someone skims when they are about to grant standing authority.
 */
export function planBounds(plan: AgentPlan, dayTicks?: number): PlanBound[] {
  return [
    {
      label: "Runs",
      value: plan.runIds.map((id) => `#${id}`).join(", ") || "none",
    },
    {
      label: "May",
      value: plan.verbs.map(verbLabel).join(", ") || "nothing",
    },
    {
      label: "Advance to",
      value:
        plan.toTick === null
          ? "not at all"
          : formatTickTime(plan.toTick, dayTicks),
    },
    {
      label: "May spend",
      value:
        plan.maxSpendCents <= 0
          ? "nothing"
          : `${formatMoneyCents(remainingCents(plan))} left of ${formatMoneyCents(
              plan.maxSpendCents,
            )}`,
    },
  ];
}

/**
 * Whether a grant still permits anything at all. A plan whose ceiling is
 * spent can still advance and re-policy, so "exhausted" is about having no
 * verbs left rather than no money — this exists so the banner can say
 * "nothing left" honestly instead of implying the money is the whole grant.
 */
export function isSpent(plan: AgentPlan): boolean {
  return plan.maxSpendCents > 0 && remainingCents(plan) === 0;
}
