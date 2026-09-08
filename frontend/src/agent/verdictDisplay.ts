/**
 * Display transforms for a computed verdict — pure, tested, and doing no
 * arithmetic the comparator has not already done.
 *
 * The division of labour matters here. Every figure in a `RunComparison` was
 * computed on the server from two runs' frozen money columns, so this file
 * only ever *formats* and *scales for drawing*. The moment it started
 * re-deriving a delta there would be two answers to "which branch won", and
 * the whole reason the comparator exists is that there is exactly one.
 */
import type {
  ComparisonLine,
  ComparisonOutcomes,
  RunComparison,
} from "./verdict";
import { formatDurationSeconds } from "../simulation/simTime";

/**
 * The bar denominator: the largest move any line made, in absolute cents.
 *
 * Scaling each line against the biggest mover rather than against the net
 * delta is deliberate. The lines routinely offset each other — a purchase
 * that pays back is throughput up and capital down — so a net-delta scale
 * would draw the two largest forces in the run as bars wider than the track
 * whenever they nearly cancelled. Zero means nothing moved, and every bar is
 * then empty rather than dividing by it.
 */
export function netEffectScale(lines: ComparisonLine[]): number {
  return lines.reduce(
    (widest, line) => Math.max(widest, Math.abs(line.netEffectCents)),
    0,
  );
}

/**
 * How much of the track a line fills, in `[0, 1]`, ignoring direction. The
 * caller decides which side of the axis to draw it on.
 */
export function barFraction(cents: number, scale: number): number {
  if (scale <= 0) return 0;
  return Math.min(1, Math.abs(cents) / scale);
}

/**
 * Cents as money, thousands grouped.
 *
 * Deliberately not `formatCents` from the order forms, which doesn't group:
 * a verdict card carries the comparator's own summary sentence, and that
 * sentence is built server-side by `format_dollars`, which does. A table
 * reading "$4487.75" directly above a sentence reading "$4,487.75" is a
 * contradiction inside one card, which is worse than differing from a page
 * the reader is not looking at. The figures here are also the largest in the
 * app — a run's whole throughput rather than one order's price.
 */
export function formatMoneyCents(cents: number): string {
  const whole = Math.trunc(Math.abs(cents) / 100).toLocaleString();
  const fraction = String(Math.abs(cents) % 100).padStart(2, "0");
  return `${cents < 0 ? "−" : ""}$${whole}.${fraction}`;
}

/**
 * A money delta with an explicit sign, because the sign is the content: this
 * is the difference a decision made, and "$1,500.00" alone leaves the reader
 * to guess the direction. Zero prints as money rather than as a dash — the
 * two runs genuinely agreed on that line, which is a finding, not a gap.
 */
export function formatDeltaCents(cents: number): string {
  const amount = formatMoneyCents(Math.abs(cents));
  if (cents === 0) return amount;
  return `${cents > 0 ? "+" : "−"}${amount}`;
}

/** A count delta, same rule about the sign carrying the meaning. */
export function formatDeltaCount(delta: number | null): string {
  if (delta === null) return "—";
  if (delta === 0) return "0";
  return `${delta > 0 ? "+" : "−"}${Math.abs(delta).toLocaleString()}`;
}

/** A fraction as a percentage, or a dash when nothing was measured. */
export function formatFraction(fraction: number | null): string {
  if (fraction === null) return "—";
  return `${Math.round(fraction * 100)}%`;
}

/**
 * A difference between two fractions, in percentage **points**. Calling five
 * points "5%" is the classic way to overstate a move from 90% to 95%, and
 * on-time delivery is exactly the figure someone quotes out of context.
 */
export function formatFractionDelta(delta: number | null): string {
  if (delta === null) return "—";
  const points = delta * 100;
  if (Math.abs(points) < 0.05) return "0 pts";
  return `${points > 0 ? "+" : "−"}${Math.abs(points).toFixed(1)} pts`;
}

/** A mean, at one decimal — or a dash where a side measured nothing. */
export function formatMean(value: number | null): string {
  return value === null ? "—" : value.toFixed(1);
}

/**
 * A *difference* between two durations, signed.
 *
 * `formatDurationSeconds` assumes a duration, so its own thresholds read a
 * negative as tiny — every improvement came out as raw seconds ("−11238s"
 * where the answer is "−3.1h"), because -11,238 is below the two-minute
 * bound. So the magnitude goes through it and the sign is put back on.
 */
export function formatDurationDelta(seconds: number | null): string {
  if (seconds === null) return "—";
  const magnitude = formatDurationSeconds(Math.abs(seconds));
  if (seconds === 0) return magnitude;
  return `${seconds > 0 ? "+" : "−"}${magnitude}`;
}

/** A count: whole, grouped, and never dressed up as a mean with a ".0". */
export function formatCount(value: number | null): string {
  return value === null ? "—" : value.toLocaleString();
}

export type OutcomeRow = {
  label: string;
  baseline: string;
  variant: string;
  delta: string;
  /**
   * Whether a rise in this row is *good*. Cycle time, WIP and scrap improve
   * by falling, so a table that coloured every increase green would recommend
   * the wrong decision — the one place this file makes a judgement, and it is
   * about the row's meaning rather than about the numbers.
   */
  higherIsBetter: boolean;
};

/**
 * The non-money half of the verdict as display rows: the reasons a net delta
 * came out the way it did. A decision that bought net profit by breaking
 * every promise, or by piling the floor high, is one a report has to be able
 * to name — the money line alone would call it a win.
 */
export function outcomeRows(outcomes: ComparisonOutcomes): OutcomeRow[] {
  return [
    {
      label: "Finished units",
      baseline: formatCount(outcomes.finished.baseline),
      variant: formatCount(outcomes.finished.variant),
      delta: formatDeltaCount(outcomes.finished.delta),
      higherIsBetter: true,
    },
    {
      label: "On-time delivery",
      baseline: formatFraction(outcomes.onTimeFraction.baseline),
      variant: formatFraction(outcomes.onTimeFraction.variant),
      delta: formatFractionDelta(outcomes.onTimeFraction.delta),
      higherIsBetter: true,
    },
    {
      label: "Mean cycle time",
      baseline: formatDurationSeconds(outcomes.meanCycleSeconds.baseline),
      variant: formatDurationSeconds(outcomes.meanCycleSeconds.variant),
      delta: formatDurationDelta(outcomes.meanCycleSeconds.delta),
      higherIsBetter: false,
    },
    {
      label: "95th cycle time",
      baseline: formatDurationSeconds(outcomes.p95CycleSeconds.baseline),
      variant: formatDurationSeconds(outcomes.p95CycleSeconds.variant),
      delta: formatDurationDelta(outcomes.p95CycleSeconds.delta),
      higherIsBetter: false,
    },
    {
      label: "Mean / peak WIP",
      baseline: `${formatMean(outcomes.meanWip.baseline)} / ${formatCount(outcomes.maxWip.baseline)}`,
      variant: `${formatMean(outcomes.meanWip.variant)} / ${formatCount(outcomes.maxWip.variant)}`,
      // the delta is the peak's, since a mean of two means is not a mean and
      // the peak is the number a pile-up shows up in
      delta: `${formatDeltaCount(outcomes.maxWip.delta)} peak`,
      higherIsBetter: false,
    },
    {
      label: "Scrapped units",
      baseline: formatCount(outcomes.scrappedCount.baseline),
      variant: formatCount(outcomes.scrappedCount.variant),
      delta: formatDeltaCount(outcomes.scrappedCount.delta),
      higherIsBetter: false,
    },
  ];
}

/**
 * Which side won, as a label rather than an id — or null on a dead heat,
 * which is the answer two same-seed branches with no decision between them
 * must give.
 */
export function winnerLabel(verdict: RunComparison): string | null {
  if (verdict.winnerRunId === null) return null;
  const side =
    verdict.winnerRunId === verdict.variant.runId
      ? verdict.variant
      : verdict.baseline;
  return `#${side.runId} ${side.name}`;
}
