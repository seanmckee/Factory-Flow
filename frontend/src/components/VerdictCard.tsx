import { ChartLine, Scale } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { formatDays, ticksToDays } from "../simulation/simTime";
import { runLink } from "../simulation/runLink";
import type { ComparisonConstraint, RunComparison } from "../agent/verdict";
import {
  barFraction,
  formatDeltaCents,
  formatMoneyCents,
  netEffectScale,
  outcomeRows,
  winnerLabel,
} from "../agent/verdictDisplay";

/**
 * A computed verdict, drawn as the table it is.
 *
 * "Which branch won, by how much, and which line of the P&L moved" is six
 * rows by three columns of exact cents, which a chart reads worse than a
 * table and a paragraph reads worst of all. The chart that *is* worth drawing
 * — the two net curves over time, with the fork seam — already exists on the
 * Trends tab, so this deliberately doesn't ship a smaller copy of it.
 *
 * Every figure here came off the comparator. The card formats and scales;
 * it computes nothing, which is what keeps the number in the transcript and
 * the number in the sim the same number.
 */
export default function VerdictCard({ verdict }: { verdict: RunComparison }) {
  const scale = netEffectScale(verdict.pl);
  const winner = winnerLabel(verdict);
  const days = verdict.window.dayTicks
    ? ticksToDays(verdict.window.toTick - verdict.window.fromTick, verdict.window.dayTicks)
    : null;

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Scale className="size-4 text-muted-foreground" />
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Verdict
          </span>
        </div>
        {/* The headline states the outcome; the sentence below it is the
            comparator's own, so the card and the model cannot disagree. */}
        <p className="text-sm font-medium">
          {winner ? `${winner} wins` : "Dead heat"}
          <span
            className={cn(
              "ml-2 tabular-nums",
              verdict.netDeltaCents < 0 && "text-destructive",
            )}
          >
            {formatDeltaCents(verdict.netDeltaCents)} net
          </span>
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {verdict.window.basis} · ticks{" "}
          {verdict.window.fromTick.toLocaleString()}–
          {verdict.window.toTick.toLocaleString()}
          {days !== null && ` · ≈ ${formatDays(days)}`}
        </p>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-1 text-left font-normal">Line</th>
              <th className="py-1 text-right font-normal">
                #{verdict.baseline.runId} control
              </th>
              <th className="py-1 text-right font-normal">
                #{verdict.variant.runId} variant
              </th>
              <th className="py-1 pl-3 text-left font-normal">Effect on net</th>
            </tr>
          </thead>
          <tbody>
            {verdict.pl.map((line) => (
              <tr key={line.line} className="border-t">
                <td className="py-1.5 pr-3">{line.label}</td>
                <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                  {formatMoneyCents(line.baselineCents)}
                </td>
                <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                  {formatMoneyCents(line.variantCents)}
                </td>
                <td className="py-1.5 pl-3">
                  <div className="flex items-center gap-2">
                    <NetEffectBar cents={line.netEffectCents} scale={scale} />
                    <span
                      className={cn(
                        "tabular-nums",
                        line.netEffectCents < 0 && "text-destructive",
                        line === verdict.biggestMover && "font-medium",
                      )}
                    >
                      {formatDeltaCents(line.netEffectCents)}
                    </span>
                  </div>
                </td>
              </tr>
            ))}
            {/* The total is the sum of the column above it by construction,
                which is the property that makes the table worth trusting. */}
            <tr className="border-t-2 font-medium">
              <td className="py-1.5 pr-3">Net</td>
              <td className="py-1.5 text-right tabular-nums">
                {formatMoneyCents(verdict.baseline.netCents)}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {formatMoneyCents(verdict.variant.netCents)}
              </td>
              <td
                className={cn(
                  "py-1.5 pl-3 tabular-nums",
                  verdict.netDeltaCents < 0 && "text-destructive",
                )}
              >
                {formatDeltaCents(verdict.netDeltaCents)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <Outcomes verdict={verdict} />

      <p className="text-xs leading-relaxed text-muted-foreground">
        {verdict.summary}
      </p>

      {/* The table is the money; the chart is the shape of it over time —
          where the branches parted and when the decision earned its cost
          back. That chart already exists, so the card links at it rather
          than redrawing it. The variant leads, since it is the run under
          test; the control overlays it dashed. */}
      <Link
        to={runLink(verdict.variant.runId, verdict.baseline.runId)}
        className="flex w-fit items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        <ChartLine className="size-3.5" />
        Open both net curves on Trends
      </Link>
    </section>
  );
}

/**
 * A diverging bar: gains right of the axis, costs left of it, every line
 * scaled against the biggest mover. Centred rather than left-aligned because
 * the direction is the finding — a purchase that pays back looks like one
 * long bar each way, which no single-sided bar can show.
 */
function NetEffectBar({ cents, scale }: { cents: number; scale: number }) {
  const width = `${barFraction(cents, scale) * 50}%`;
  const positive = cents > 0;
  return (
    <div className="relative h-1.5 w-20 shrink-0 rounded-full bg-muted">
      <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
      {cents !== 0 && (
        <div
          className={cn(
            "absolute inset-y-0",
            positive ? "rounded-r-full bg-chart-2" : "rounded-l-full bg-destructive",
          )}
          style={positive ? { left: "50%", width } : { right: "50%", width }}
        />
      )}
    </div>
  );
}

/** The reasons behind the delta: a win bought by breaking promises is a fact
 * the money line alone would hide. */
function Outcomes({ verdict }: { verdict: RunComparison }) {
  const rows = outcomeRows(verdict.outcomes);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-2">
            <span className="text-muted-foreground">{row.label}</span>
            <span className="tabular-nums">
              <span className="text-muted-foreground">
                {row.baseline} → {row.variant}
              </span>
              <span className="ml-2">{row.delta}</span>
            </span>
          </div>
        ))}
      </div>
      <ConstraintLine
        baseline={verdict.outcomes.constraint.baseline}
        variant={verdict.outcomes.constraint.variant}
      />
    </div>
  );
}

/**
 * Where the constraint sat on each side. Work centre **ids**, not names: the
 * comparator reads metrics, which carry ids, and a run keeps no copy of the
 * names — resolving them means a floor read this card does not make. A moved
 * constraint is the signature of a capacity decision that worked, so it earns
 * its own line rather than a cell in the grid.
 */
function ConstraintLine({
  baseline,
  variant,
}: {
  baseline: ComparisonConstraint | null;
  variant: ComparisonConstraint | null;
}) {
  if (!baseline && !variant) return null;
  const moved =
    baseline && variant && baseline.workCenterId !== variant.workCenterId;
  return (
    <p className="text-xs text-muted-foreground tabular-nums">
      Constraint {describeConstraint(baseline)} → {describeConstraint(variant)}
      {moved && <span className="ml-1 text-foreground">· it moved</span>}
    </p>
  );
}

function describeConstraint(constraint: ComparisonConstraint | null): string {
  if (!constraint) return "none";
  return `work center ${constraint.workCenterId} at ${Math.round(constraint.utilization * 100)}%`;
}
