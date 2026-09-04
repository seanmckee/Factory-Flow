import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { FloorWorkCenter, RunMetrics } from "../api/runs";
import { formatCents, formatSignedCents } from "../orders/salesOrderMath";
import { formatDays, ticksToDays } from "../simulation/simTime";
import { windowStandingCostCents } from "../simulation/standingCost";

/**
 * The run dashboard — Track 5's replacement for the one-row placeholder strip.
 *
 * Everything here is a rate over a window, and the window label is still the
 * load-bearing part: the same work center reads 10% utilization over a whole
 * run and 52% over the ticks it was working, so the label comes from the
 * *response* rather than from what the page asked for, and a dashboard left
 * over from an earlier window states what it covers instead of misleading.
 *
 * The window controls are the only new way `/metrics` gets fetched — it reads
 * and aggregates every observation in the window, so it is still never on the
 * display clock's beat. A jump keeps re-windowing onto its own ticks.
 */

/** "Last N ticks" presets. The whole run is the unwindowed request. */
const WINDOW_PRESETS = [1000, 5000];

/** Utilization at which a centre reads as the constraint at a glance. */
const SATURATED_UTILIZATION = 0.9;

function formatSeconds(seconds: number | null) {
  if (seconds === null) return "—";
  return seconds < 120
    ? `${Math.round(seconds)}s`
    : `${(seconds / 60).toFixed(1)}m`;
}

function StatCard({
  label,
  value,
  detail,
  negative = false,
}: {
  label: string;
  value: string;
  detail?: string;
  /** money below zero reads in the destructive tone */
  negative?: boolean;
}) {
  return (
    <div className="flex min-w-40 flex-col gap-1 rounded-lg border bg-card p-4">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "text-lg font-medium tabular-nums",
          negative && "text-destructive",
        )}
      >
        {value}
      </span>
      {detail && (
        <span className="text-xs text-muted-foreground tabular-nums">
          {detail}
        </span>
      )}
    </div>
  );
}

/** A utilization readout: filled bar plus the figure, saturated when near 1. */
function UtilizationBar({ utilization }: { utilization: number }) {
  const saturated = utilization >= SATURATED_UTILIZATION;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full",
            saturated ? "bg-saturated" : "bg-chart-2",
          )}
          style={{ width: `${Math.min(100, utilization * 100)}%` }}
        />
      </div>
      <span
        className={cn("tabular-nums", saturated && "font-medium text-saturated")}
      >
        {Math.round(utilization * 100)}%
      </span>
    </div>
  );
}

function RunDashboard({
  metrics,
  centers,
  tickNum,
  dayTicks,
  onWindow,
}: {
  metrics: RunMetrics;
  /** Names, frozen capacities and frozen standing rates — `/metrics` carries ids. */
  centers: FloorWorkCenter[];
  /** The run's current tick, which is what "last N" is relative to. */
  tickNum: number;
  /** The run's frozen day length — what its per-day rates accrue over. */
  dayTicks: number;
  /** Re-fetches `/metrics` over a window; both bounds omitted is the whole run. */
  onWindow: (fromTick?: number, toTick?: number) => void;
}) {
  const [fromDraft, setFromDraft] = useState("");
  const [toDraft, setToDraft] = useState("");

  const {
    fromTick,
    toTick,
    throughputCents,
    operatingExpenseCents,
    carryingCostCents,
    netCents,
    flow,
    cycleTime,
  } = metrics;

  const centerById = new Map(centers.map((center) => [center.workCenterId, center]));
  // utilization descending: the constraint on top is the point of the table.
  // The floor keeps stable name order because it redraws every tick; this
  // redraws only when a window is asked for, so rows can rank.
  const rankedCenters = [...flow.workCenters].sort(
    (a, b) =>
      b.utilization - a.utilization || a.workCenterId - b.workCenterId,
  );

  const applyCustomWindow = () => {
    const from = fromDraft.trim() === "" ? undefined : Number(fromDraft);
    const to = toDraft.trim() === "" ? undefined : Number(toDraft);
    onWindow(from, to);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* The window: what every figure below is a rate over. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground tabular-nums">
          Ticks {fromTick.toLocaleString()}–{toTick.toLocaleString()} ·{" "}
          {flow.tickCount.toLocaleString()} observed · ≈{" "}
          {formatDays(ticksToDays(flow.tickCount, dayTicks))}
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => onWindow()}>
            Whole run
          </Button>
          {WINDOW_PRESETS.map((ticks) => (
            <Button
              key={ticks}
              size="sm"
              variant="outline"
              className="tabular-nums"
              onClick={() => onWindow(Math.max(1, tickNum - ticks + 1))}
              disabled={tickNum === 0}
            >
              Last {ticks.toLocaleString()}
            </Button>
          ))}
          <form
            className="flex items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              applyCustomWindow();
            }}
          >
            <Input
              type="number"
              min={1}
              placeholder="from"
              value={fromDraft}
              onChange={(event) => setFromDraft(event.target.value)}
              className="h-8 w-24 tabular-nums"
            />
            <span className="text-muted-foreground">–</span>
            <Input
              type="number"
              min={1}
              placeholder="to"
              value={toDraft}
              onChange={(event) => setToDraft(event.target.value)}
              className="h-8 w-24 tabular-nums"
            />
            <Button size="sm" variant="secondary" type="submit">
              Apply
            </Button>
          </form>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap gap-3">
        <StatCard
          label="Net profit"
          value={formatSignedCents(netCents)}
          detail="throughput − opex − carrying, this window"
          negative={netCents < 0}
        />
        <StatCard
          label="Throughput"
          value={formatCents(throughputCents)}
          detail="money made through sales, this window"
        />
        <StatCard
          label="Operating expense"
          value={formatCents(operatingExpenseCents)}
          detail="standing costs + facility overhead"
        />
        <StatCard
          label="Carrying cost"
          value={formatCents(carryingCostCents)}
          detail="WIP material value × rate, per tick"
        />
        <StatCard
          label="Finished"
          value={cycleTime.count.toLocaleString()}
          detail="parts completed in the window"
        />
        <StatCard
          label="Cycle time med / p95"
          value={`${formatSeconds(cycleTime.medianSeconds)} / ${formatSeconds(
            cycleTime.p95Seconds,
          )}`}
          detail={`mean ${formatSeconds(cycleTime.meanSeconds)} · range ${formatSeconds(
            cycleTime.minSeconds,
          )}–${formatSeconds(cycleTime.maxSeconds)}`}
        />
        <StatCard
          label="WIP mean / peak"
          value={`${flow.meanWip.toFixed(1)} / ${flow.maxWip.toLocaleString()}`}
          detail={`${flow.finalWip.toLocaleString()} on the floor at window end`}
        />
      </div>

      {/* The constraint finder. Utilization near 1 over a real window is the
          bottleneck's signature — the instantaneous figure the floor tab
          deliberately doesn't show. */}
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-card">
        <Table>
          <TableHeader className="sticky top-0 bg-card">
            <TableRow>
              <TableHead>Work Center</TableHead>
              <TableHead>Machines</TableHead>
              <TableHead className="text-right">Standing cost</TableHead>
              <TableHead>Utilization</TableHead>
              <TableHead className="text-right">Busy machine-ticks</TableHead>
              <TableHead className="text-right">Queue mean</TableHead>
              <TableHead className="text-right">Queue max</TableHead>
              <TableHead className="text-right">Observed ticks</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rankedCenters.map((center) => {
              const live = centerById.get(center.workCenterId);
              return (
                <TableRow key={center.workCenterId}>
                  <TableCell className="font-medium">
                    {live?.name ?? `WC ${center.workCenterId}`}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {live?.capacity ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {live
                      ? formatCents(
                          windowStandingCostCents(
                            live.standingCostCentsPerDay,
                            center.observedTicks,
                            dayTicks,
                          ),
                        )
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <UtilizationBar utilization={center.utilization} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {center.busyMachineTicks.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {center.meanQueueDepth.toFixed(1)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {center.maxQueueDepth.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {center.observedTicks.toLocaleString()}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default RunDashboard;
