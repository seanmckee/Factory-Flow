/**
 * The comparator's verdict, as the agent service puts it on the wire.
 *
 * A mirror of `agent/src/factory_agent/comparator.py`, and deliberately a
 * dumb one: every figure here was computed from two runs' frozen money
 * columns, so nothing in this file recomputes, re-sums or reinterprets. The
 * frontend's job is to draw what the sim worked out — the same rule that
 * keeps `src/simulation/` to display transforms and leaves the engine on the
 * server.
 */

/** one run's side of the comparison */
export type ComparisonSide = {
  runId: number;
  name: string;
  tickNum: number;
  netCents: number;
};

/**
 * One line of the P&L. `netEffectCents` is the line's contribution to the net
 * delta — signed against the *score*, so a cost that rose reads negative
 * without the reader flipping the sign. The five sum to `netDeltaCents`.
 */
export type ComparisonLine = {
  line: string;
  label: string;
  baselineCents: number;
  variantCents: number;
  deltaCents: number;
  netEffectCents: number;
};

/**
 * The ticks the figures cover, straight from the metrics responses rather
 * than from what was asked for — `/metrics` snaps a window to whole
 * observation buckets, so these are the ticks actually measured. `basis` says
 * why the window starts where it does ("since the fork at Day 4 · 0:00:00").
 */
export type ComparisonWindow = {
  fromTick: number;
  toTick: number;
  dayTicks: number | null;
  basis: string;
  forkedAtTick: number | null;
};

/** a side's constraint by id — the name is joined from `/floor`, as the
 * dashboard does, since metrics carry ids and a run keeps no copy of names */
export type ComparisonConstraint = {
  workCenterId: number;
  utilization: number;
  busyMachineTicks: number;
  capacityTicks: number;
};

/** null is not zero: a null delta means one side measured nothing */
export type OutcomeDelta = {
  baseline: number | null;
  variant: number | null;
  delta: number | null;
};

export type ComparisonOutcomes = {
  finished: OutcomeDelta;
  onTimeFraction: OutcomeDelta & {
    baselineMeasured: number;
    variantMeasured: number;
  };
  meanCycleSeconds: OutcomeDelta;
  p95CycleSeconds: OutcomeDelta;
  meanWip: OutcomeDelta;
  maxWip: OutcomeDelta;
  scrappedCount: OutcomeDelta;
  constraint: {
    baseline: ComparisonConstraint | null;
    variant: ComparisonConstraint | null;
  };
};

export type RunComparison = {
  baseline: ComparisonSide;
  variant: ComparisonSide;
  window: ComparisonWindow;
  /** null on a dead heat, which is a real answer rather than a missing one */
  winnerRunId: number | null;
  netDeltaCents: number;
  pl: ComparisonLine[];
  /** null when nothing moved */
  biggestMover: ComparisonLine | null;
  outcomes: ComparisonOutcomes;
  /** the service's own one-line verdict, in the sim's vocabulary */
  summary: string;
};

/**
 * Narrows a result payload, or returns null.
 *
 * It checks the fields the UI reads rather than every field on the shape:
 * this is our own service, so the risk is a version skew after a deploy, not
 * a hostile payload — and the honest response to skew is to draw nothing and
 * leave the model's prose standing, which is the same "skip rather than
 * throw" rule `parseSseChunk` follows for a malformed frame.
 */
export function parseComparison(data: unknown): RunComparison | null {
  if (typeof data !== "object" || data === null) return null;
  const candidate = data as Partial<RunComparison>;
  if (typeof candidate.summary !== "string") return null;
  if (typeof candidate.netDeltaCents !== "number") return null;
  if (!Array.isArray(candidate.pl)) return null;
  if (!candidate.baseline || !candidate.variant || !candidate.window) return null;
  return candidate as RunComparison;
}
