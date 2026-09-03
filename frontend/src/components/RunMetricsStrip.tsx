import type { RunMetrics } from "../api/runs";

/**
 * What the run did over a window, in one row — the payoff of a fast-forward.
 *
 * Deliberately not a dashboard: Track 5 builds that, and this exists so a jump
 * lands on something readable instead of on a bigger number in the money line.
 *
 * The window label is the load-bearing part. Every figure here is a rate over
 * a window, and the same work center reads 10% utilization over a whole run
 * and 52% over the ticks it was working — so the strip states which ticks it
 * is talking about, taken from the response rather than from what the page
 * asked for. That also makes a strip left over from an earlier window honest
 * rather than misleading: it says what it covers.
 */
function formatSeconds(seconds: number | null) {
  if (seconds === null) return "—";
  return seconds < 120
    ? `${Math.round(seconds)}s`
    : `${(seconds / 60).toFixed(1)}m`;
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <span className="tabular-nums text-slate-700">{value}</span>
    </div>
  );
}

function RunMetricsStrip({
  metrics,
  centerNames,
}: {
  metrics: RunMetrics;
  /** Names live only in the live work_centers table, so they come off the floor. */
  centerNames: Map<number, string>;
}) {
  const { fromTick, toTick, throughputCents, flow, cycleTime } = metrics;

  // the constraint: whatever ran closest to flat out. `workCenters` is total by
  // the engine's contract — idle centers included — so this is never empty for
  // a run that has any centers at all.
  const busiest = flow.workCenters.reduce<
    RunMetrics["flow"]["workCenters"][number] | null
  >(
    (worst, center) =>
      worst === null || center.utilization > worst.utilization ? center : worst,
    null,
  );

  return (
    <div className="flex w-full max-w-3xl flex-col gap-2 rounded-lg border border-slate-300 bg-white p-4 text-sm">
      <p className="text-xs text-slate-500 tabular-nums">
        Ticks {fromTick.toLocaleString()}–{toTick.toLocaleString()} ·{" "}
        {flow.tickCount.toLocaleString()} observed
      </p>

      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <Figure
          label="Throughput"
          value={`$${(throughputCents / 100).toFixed(2)}`}
        />
        <Figure
          label="Cycle time med / p95"
          value={`${formatSeconds(cycleTime.medianSeconds)} / ${formatSeconds(
            cycleTime.p95Seconds,
          )}`}
        />
        <Figure label="Finished" value={`${cycleTime.count.toLocaleString()}`} />
        <Figure
          label="WIP mean / peak"
          value={`${flow.meanWip.toFixed(1)} / ${flow.maxWip}`}
        />
        {busiest && (
          <Figure
            label="Busiest center"
            value={`${
              centerNames.get(busiest.workCenterId) ??
              `WC ${busiest.workCenterId}`
            } · ${Math.round(busiest.utilization * 100)}% · queue ≤ ${
              busiest.maxQueueDepth
            }`}
          />
        )}
      </div>
    </div>
  );
}

export default RunMetricsStrip;
