import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FastForward, Info, Play, Plus, Square, Trash2 } from "lucide-react";
import WorkCenterTable from "../components/WorkCenterTable";
import SimulatingOverlay from "../components/SimulatingOverlay";
import RunDashboard from "../components/RunDashboard";
import TickSeriesChart from "../components/TickSeriesChart";
import {
  cumulativeThroughput,
  openingCents,
} from "../simulation/cumulativeThroughput";
import { netPerTick, openingNetCents } from "../simulation/netProfit";
import { throughputRate } from "../simulation/throughputRate";
import { formatCents, formatSignedCents } from "../orders/salesOrderMath";
import { ApiError, getJson } from "../api/client";
import {
  advanceRun,
  createRun,
  deleteRun,
  getRun,
  getRunFloor,
  getRunMetrics,
  getRunTicks,
  listRuns,
  releaseWorkOrder,
  unlockRun,
  type Run,
  type RunFloor,
  type RunMetrics,
  type RunSummary,
  type TickSample,
} from "../api/runs";
import type { WorkOrder } from "../types/WorkOrder";
import { useToast } from "../toast/ToastContext";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Field } from "../components/ui/Field";

/** One tick is one simulated second, so ticking once a second runs real-time. */
const TICK_INTERVAL_MS = 1000;

/**
 * A jump advances in chunks of one server transaction (`TICKS_PER_BATCH`), so
 * stopping one always lands on a committed tick boundary — a partly-advanced
 * run is not a state that exists.
 */
const CHUNK_TICKS = 500;

/** The preset jumps. Anything longer is what running until idle is for. */
const JUMP_TICKS = [100, 500, 1000];

/**
 * Where running until idle gives up. A floor that never empties — a routing
 * nothing can finish, demand that outruns the constraint — would otherwise
 * advance until the tab was closed.
 */
const IDLE_TICK_CEILING = 100_000;

/**
 * How long a jump has to be running before the overlay appears. Every preset
 * clears this, so it behaves as "always" for real work; it exists so a jump
 * that returns immediately doesn't flash a modal for a frame.
 */
const OVERLAY_DELAY_MS = 200;

/** A jump in flight: what it is doing and how far it has got. */
type JumpProgress = {
  label: string;
  ticksDone: number;
  /** null while running until idle — the end is unknown until WIP hits zero. */
  ticksTotal: number | null;
  tickNum: number | null;
};

/**
 * A chart in a card, titled, with a hover hint saying what the chart answers.
 * The y-axis label says what is plotted; the hint says why you'd look at it.
 */
function ChartCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border bg-card p-4">
      <div className="flex shrink-0 items-center gap-1.5 pb-2">
        <span className="text-sm font-medium">{title}</span>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              className="text-muted-foreground hover:text-foreground"
              aria-label={`What "${title}" shows`}
            >
              <Info className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent className="max-w-72">{hint}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

/** One figure in the run bar's readout. */
function Stat({
  label,
  value,
  negative = false,
}: {
  label: string;
  value: string;
  /** money below zero reads in the destructive tone */
  negative?: boolean;
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={negative ? "font-medium text-destructive" : "font-medium"}>
        {value}
      </span>
    </span>
  );
}

/**
 * Drives a server-side run. The engine lives in the backend — this page picks
 * a run, releases work orders into it, advances it a tick at a time and draws
 * what comes back. It holds no simulation state of its own: WIP, money and the
 * tick number are all the run's, so a reload picks the same run back up where
 * it was and two browser tabs cannot disagree about the factory.
 */
function SimulationPage() {
  const { showToast } = useToast();

  const [runs, setRuns] = useState<Run[]>([]);
  const [runId, setRunId] = useState<number | null>(null);
  const [run, setRun] = useState<RunSummary | null>(null);
  const [floor, setFloor] = useState<RunFloor | null>(null);
  const [series, setSeries] = useState<TickSample[]>([]);
  const [metrics, setMetrics] = useState<RunMetrics | null>(null);

  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [newRunName, setNewRunName] = useState("");
  const [newRunOpen, setNewRunOpen] = useState(false);

  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const [jump, setJump] = useState<JumpProgress | null>(null);
  const [showOverlay, setShowOverlay] = useState(false);
  const [stopping, setStopping] = useState(false);
  const stopJump = useRef(false);

  const report = useCallback(
    (error: unknown, fallback: string) => {
      showToast(error instanceof ApiError ? error.message : fallback, "error");
    },
    [showToast],
  );

  /**
   * A failed advance is the one error here the user can act on. Advancing
   * takes the run's `advancing` lock, and a tab closed or a server restarted
   * mid-jump leaves that lock set with no process behind it — after which
   * every advance is a 409 for good, and curl is the only cure. So the 409
   * carries an action.
   *
   * Labelled as clearing a *stale* lock rather than as a retry, because that
   * is the assertion the user is making: if the run really is advancing
   * somewhere else, clearing it lets two writers rewrite the same WIP rows.
   */
  const reportAdvance = useCallback(
    (error: unknown, id: number) => {
      if (error instanceof ApiError && error.status === 409) {
        return showToast(error.message, "error", {
          label: "Clear stale lock",
          onClick: async () => {
            try {
              await unlockRun(id);
              showToast("Cleared the lock — the run is idle again");
            } catch (unlockError) {
              report(unlockError, "Failed to clear the lock");
            }
          },
        });
      }
      report(error, "Failed to advance the run");
    },
    [report, showToast],
  );

  /** Everything the page draws, in one place, so a tick refreshes it together. */
  const refresh = useCallback(
    async (id: number) => {
      const [summary, runFloor, ticks] = await Promise.all([
        getRun(id),
        getRunFloor(id),
        getRunTicks(id),
      ]);
      setRun(summary);
      setFloor(runFloor);
      setSeries(ticks);
      // keep the picker's tick number honest as the run advances
      setRuns((prev) =>
        prev.map((option) =>
          option.id === summary.id
            ? { ...option, tickNum: summary.tickNum, status: summary.status }
            : option,
        ),
      );
    },
    [],
  );

  /**
   * The strip's window: the whole run when one is opened, the jump's own ticks
   * after a jump. Deliberately *not* on the clock's beat — `/metrics` reads
   * and aggregates every observation in the window, which is a per-center row
   * per center per tick, and no eye reads a strip that redraws every second.
   */
  const loadMetrics = useCallback(
    async (id: number, fromTick?: number, toTick?: number) => {
      try {
        setMetrics(await getRunMetrics(id, fromTick, toTick));
      } catch (error) {
        report(error, "Failed to load run metrics");
      }
    },
    [report],
  );

  // remounts on navigation, so work orders created in the order entry module
  // show up without a reload
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [runList, orders] = await Promise.all([
          listRuns(),
          getJson<WorkOrder[]>("/api/work-orders"),
        ]);
        if (cancelled) return;
        setRuns(runList);
        setWorkOrders(orders);
        // the newest run is the one being worked on
        const latest = runList.at(-1);
        if (latest) setRunId(latest.id);
      } catch (error) {
        if (!cancelled) report(error, "Failed to load runs");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [report]);

  /**
   * Switching runs clears what was drawn here rather than letting an effect do
   * it, so the cards never show one run's floor under another run's name for
   * the frame before the fetch lands.
   */
  const selectRun = useCallback((id: number | null) => {
    setIsRunning(false);
    setRunId(id);
    // the picker filters against the *selected* run's releases, so a selection
    // carried across runs could name an order the new run already released
    setSelectedOrderId(null);
    setRun(null);
    setFloor(null);
    setSeries([]);
    setMetrics(null);
  }, []);

  useEffect(() => {
    if (runId === null) return;
    let cancelled = false;
    async function load(id: number) {
      try {
        await refresh(id);
      } catch (error) {
        if (!cancelled) report(error, "Failed to load run");
        return;
      }
      if (!cancelled) await loadMetrics(id);
    }
    load(runId);
    return () => {
      cancelled = true;
    };
  }, [runId, refresh, report, loadMetrics]);

  /**
   * Advancing is synchronous on the server and holds a lock, so a second call
   * arriving mid-advance is a 409. This guard skips a beat rather than firing
   * one: the interval is a display clock, not a queue.
   */
  const advancing = useRef(false);

  useEffect(() => {
    if (!isRunning || runId === null) return;

    const interval = setInterval(async () => {
      if (advancing.current) return;
      advancing.current = true;
      try {
        await advanceRun(runId, 1);
        await refresh(runId);
      } catch (error) {
        setIsRunning(false);
        reportAdvance(error, runId);
      } finally {
        advancing.current = false;
      }
    }, TICK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isRunning, runId, refresh, reportAdvance]);

  /**
   * A beat in flight holds the run's lock, and a jump landing on top of it
   * would be the 409 the unlock affordance exists for — raised by normal use
   * rather than by a dead process. A beat is one tick, so waiting it out is a
   * fraction of a second; the bound is there so a hung request can't hang the
   * button too.
   */
  const awaitIdleClock = useCallback(async () => {
    for (let attempt = 0; advancing.current && attempt < 40; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return !advancing.current;
  }, []);

  /**
   * Fast-forwards the run: a fixed number of ticks, or until the floor is
   * empty. Chunked at `CHUNK_TICKS` so Stop always lands on a committed
   * boundary, and terminated on the advance's own `wipCount` rather than on a
   * follow-up read that could be a chunk stale.
   *
   * This is the point of the page now — not watching the factory run faster,
   * but jumping ahead to see where a set of releases ends up. The 1x clock is
   * still there for watching, and a jump stops it first: the two contend for
   * the same server lock and the jump is the one that matters.
   */
  const runJump = useCallback(
    async (target: number | "idle") => {
      if (runId === null) return showToast("Create or select a run first", "error");
      if (jump) return;

      const untilIdle = target === "idle";
      if (untilIdle && (run?.wipCount ?? 0) === 0) {
        return showToast("Nothing on the floor — release a work order first", "error");
      }

      setIsRunning(false);
      if (!(await awaitIdleClock())) {
        return showToast("The run is still advancing — try again", "error");
      }

      const label = untilIdle
        ? "Running until the floor is empty"
        : `Advancing ${target.toLocaleString()} ticks`;
      const ticksTotal = untilIdle ? null : target;

      const startTick = run?.tickNum ?? 0;
      advancing.current = true;
      stopJump.current = false;
      setStopping(false);
      setJump({ label, ticksDone: 0, ticksTotal, tickNum: null });
      const gate = window.setTimeout(() => setShowOverlay(true), OVERLAY_DELAY_MS);

      const ceiling = ticksTotal ?? IDLE_TICK_CEILING;
      let done = 0;
      let hitCeiling = false;
      try {
        while (done < ceiling && !stopJump.current) {
          const size = Math.min(CHUNK_TICKS, ceiling - done);
          const result = await advanceRun(runId, size);
          done += result.ticksAdvanced;
          setJump({ label, ticksDone: done, ticksTotal, tickNum: result.tickNum });
          if (untilIdle && result.wipCount === 0) break;
          if (untilIdle && done >= ceiling) hitCeiling = true;
        }
      } catch (error) {
        reportAdvance(error, runId);
      } finally {
        window.clearTimeout(gate);
        setShowOverlay(false);
        setJump(null);
        setStopping(false);
        advancing.current = false;
      }

      try {
        await refresh(runId);
      } catch (error) {
        report(error, "Failed to load run");
      }

      // the strip re-windows onto exactly what the jump covered, which is the
      // question a jump asks: what happened over *those* ticks
      if (done > 0) await loadMetrics(runId, startTick + 1, startTick + done);

      if (hitCeiling) {
        showToast(
          `Stopped at ${IDLE_TICK_CEILING.toLocaleString()} ticks with work still on the floor`,
          "error",
        );
      }
    },
    [
      runId,
      run,
      jump,
      awaitIdleClock,
      refresh,
      loadMetrics,
      report,
      reportAdvance,
      showToast,
    ],
  );

  const onCreateRun = async () => {
    const name = newRunName.trim();
    if (!name) return showToast("Name the run", "error");
    try {
      const created = await createRun(name);
      setRuns((prev) => [...prev, created]);
      selectRun(created.id);
      setNewRunName("");
      setNewRunOpen(false);
      showToast(`Run "${created.name}" created with seed ${created.rngSeed}`);
    } catch (error) {
      report(error, "Failed to create the run");
    }
  };

  const onDeleteRun = async () => {
    if (runId === null) return;
    try {
      const deleted = await deleteRun(runId);
      const remaining = runs.filter((option) => option.id !== deleted.id);
      setRuns(remaining);
      selectRun(remaining.at(-1)?.id ?? null);
      showToast(`Deleted run "${deleted.name}"`);
    } catch (error) {
      report(error, "Failed to delete the run");
    }
  };

  const onRelease = async () => {
    if (runId === null) return showToast("Create or select a run first", "error");
    if (selectedOrderId === null) {
      return showToast("Select a work order to release", "error");
    }
    // releasing takes the same server-side lock as advancing, so wait out a
    // beat in flight and hold the guard — otherwise Release racing the 1x
    // clock is a spurious 409, indistinguishable from a stale lock
    if (!(await awaitIdleClock())) {
      return showToast("The run is still advancing — try again", "error");
    }
    advancing.current = true;
    try {
      const released = await releaseWorkOrder(runId, selectedOrderId);
      setSelectedOrderId(null);
      await refresh(runId);
      showToast(
        `Released ${released.partsReleased} parts at tick ${released.releasedAtTick}`,
      );
    } catch (error) {
      report(error, "Failed to release the work order");
    } finally {
      advancing.current = false;
    }
  };

  // `/ticks` keeps only the newest 5000 rows, so past tick 5000 this series is
  // a suffix of the run: the cumulative curve carries on from what the run had
  // already earned rather than re-basing at zero and contradicting the money
  // above it. The rate and WIP series are local by construction, so the suffix
  // needs no such correction for them.
  const runTotalCents = run?.throughputCents ?? 0;
  const runNetTotalCents = run?.netCents ?? 0;
  const charts = useMemo(() => {
    const history = series.map((sample) => ({
      tick: sample.tickNum,
      cents: sample.throughputCents,
    }));
    const pnlHistory = series.map((sample) => ({
      tick: sample.tickNum,
      throughputCents: sample.throughputCents,
      operatingExpenseCents: sample.operatingExpenseCents,
      carryingCostCents: sample.carryingCostCents,
    }));
    const toPoint = ({ tick, cents }: { tick: number; cents: number }) => ({
      tick,
      value: cents,
    });
    // both curves come off the same /ticks response, so a zip by index is
    // exact; the net curve's opening is deliberately unfloored — see netProfit
    const cumulative = cumulativeThroughput(
      history,
      openingCents(history, runTotalCents),
    ).map(toPoint);
    const net = cumulativeThroughput(
      netPerTick(pnlHistory),
      openingNetCents(pnlHistory, runNetTotalCents),
    );
    return {
      cumulative: cumulative.map((point, i) => ({
        ...point,
        secondary: net[i]?.cents,
      })),
      rate: throughputRate(history).map(toPoint),
      wip: series.map((sample) => ({
        tick: sample.tickNum,
        value: sample.wipCount,
      })),
    };
  }, [series, runTotalCents, runNetTotalCents]);
  const workOrderById = new Map(workOrders.map((wo) => [wo.id, wo]));
  // (run_id, work_order_id) is the release table's primary key — a work order
  // releases once per run — so an already-released order leaves the picker
  // instead of surfacing the server's 409 as a toast
  const releasedIds = new Set(
    (run?.releasedOrders ?? []).map((released) => released.workOrderId),
  );
  const releasableOrders = workOrders.filter((wo) => !releasedIds.has(wo.id));

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-6">
      {/* Run bar: pick or create the run everything below drives. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Select
          value={runId === null ? "" : String(runId)}
          onValueChange={(value) => selectRun(Number(value))}
          disabled={jump !== null}
        >
          <SelectTrigger className="w-64">
            <SelectValue placeholder="No run selected" />
          </SelectTrigger>
          <SelectContent>
            {runs.map((option) => (
              <SelectItem key={option.id} value={String(option.id)}>
                #{option.id} · {option.name} · tick{" "}
                {option.tickNum.toLocaleString()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Dialog open={newRunOpen} onOpenChange={setNewRunOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" disabled={jump !== null}>
              <Plus className="size-4" /> New Run
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-sm">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                onCreateRun();
              }}
              className="flex flex-col gap-4"
            >
              <DialogHeader>
                <DialogTitle>New run</DialogTitle>
                <DialogDescription>
                  Freezes today's work centers and cost rates, and draws its own
                  seed — re-creating a run with the same seed reproduces it
                  exactly.
                </DialogDescription>
              </DialogHeader>
              <Field label="Name">
                <Input
                  value={newRunName}
                  onChange={(event) => setNewRunName(event.target.value)}
                  placeholder="e.g. release everything"
                />
              </Field>
              <DialogFooter>
                <Button type="submit">Create Run</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <Button
          variant="ghost"
          onClick={onDeleteRun}
          disabled={runId === null || jump !== null}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-4" /> Delete Run
        </Button>

        {run && (
          <div className="ml-auto flex flex-wrap items-center gap-4 tabular-nums">
            <Stat label="Tick" value={run.tickNum.toLocaleString()} />
            <Stat label="WIP" value={run.wipCount.toLocaleString()} />
            <Stat label="Finished" value={run.finishedCount.toLocaleString()} />
            <Stat label="Throughput" value={formatCents(run.throughputCents)} />
            <Stat
              label="Net"
              value={formatSignedCents(run.netCents)}
              negative={run.netCents < 0}
            />
            <span className="text-xs text-muted-foreground">
              seed {run.rngSeed}
            </span>
          </div>
        )}
      </div>

      {/* Transport bar: the clock, releasing, and the jumps. Always on screen —
          the scroll-to-act problem this layout replaced was the point. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2">
        <Button
          size="sm"
          variant={isRunning ? "secondary" : "default"}
          onClick={() => setIsRunning((prev) => !prev)}
          disabled={runId === null || jump !== null}
        >
          {isRunning ? (
            <>
              <Square className="size-4" /> Stop
            </>
          ) : (
            <>
              <Play className="size-4" /> Start
            </>
          )}
        </Button>

        <div className="h-6 w-px bg-border" />

        <Select
          value={selectedOrderId === null ? "" : String(selectedOrderId)}
          onValueChange={(value) => setSelectedOrderId(Number(value))}
        >
          <SelectTrigger size="sm" className="w-72">
            <SelectValue placeholder="Select a work order" />
          </SelectTrigger>
          <SelectContent>
            {releasableOrders.length === 0 && (
              <p className="px-2 py-1.5 text-sm text-muted-foreground">
                Every work order is released into this run
              </p>
            )}
            {releasableOrders.map((workOrder) => (
              <SelectItem key={workOrder.id} value={String(workOrder.id)}>
                {workOrder.orderNumber} · {workOrder.partName} · qty{" "}
                {workOrder.quantity}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="secondary"
          onClick={onRelease}
          disabled={runId === null || jump !== null}
        >
          Release Order
        </Button>

        <div className="h-6 w-px bg-border" />

        {/* Fast-forward. The clock is for watching; these are for seeing where
            a run ends up, which is what the presets and until-idle answer. */}
        <span className="text-xs text-muted-foreground">Fast-forward</span>
        {JUMP_TICKS.map((ticks) => (
          <Button
            key={ticks}
            size="sm"
            variant="outline"
            className="tabular-nums"
            onClick={() => runJump(ticks)}
            disabled={runId === null || jump !== null}
          >
            +{ticks.toLocaleString()}
          </Button>
        ))}
        <Button
          size="sm"
          variant="outline"
          onClick={() => runJump("idle")}
          disabled={runId === null || jump !== null}
        >
          <FastForward className="size-4" /> Run until idle
        </Button>
      </div>

      {run ? (
        <Tabs defaultValue="floor" className="flex min-h-0 flex-1 flex-col gap-3">
          {/* Three view shapes, named by shape rather than by one metric:
              Floor is a snapshot of now, Trends are series over time, and
              Dashboard is an aggregate over a window. ("Throughput" stopped
              being an honest tab name once rate and WIP moved in, and
              "Metrics" overlapped it — throughput is itself a metric.) */}
          <TabsList className="shrink-0 self-start">
            <TabsTrigger value="floor">Floor</TabsTrigger>
            <TabsTrigger value="trends">Trends</TabsTrigger>
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          </TabsList>

          <TabsContent
            value="floor"
            className="flex min-h-0 flex-1 flex-col gap-2"
          >
            <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-card">
              {floor && <WorkCenterTable centers={floor.workCenters} />}
            </div>
            <div className="shrink-0 text-xs text-muted-foreground">
              {run.releasedOrders.length === 0 ? (
                <p>
                  Nothing released yet — pick a work order in the bar above and
                  release it onto the floor.
                </p>
              ) : (
                <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                  {run.releasedOrders.map((released) => {
                    const wo = workOrderById.get(released.workOrderId);
                    return (
                      <span key={released.workOrderId}>
                        {wo?.orderNumber ?? `WO ${released.workOrderId}`}
                        {wo?.partName ? ` (${wo.partName})` : ""} · routing{" "}
                        {released.routingId} rev {released.routingRevision}
                      </span>
                    );
                  })}
                </div>
              )}
              <p className="mt-1 text-muted-foreground/70">
                Machine counts are frozen when a run is created. Change them in
                Factory Setup and they apply to the next run.
              </p>
            </div>
          </TabsContent>

          {/* Cumulative money on top, then the two local series: the rate is
              where a stall or a burst is a shape rather than a change of
              slope, and WIP is the book's other axis. The region scrolls on a
              short viewport; the page doesn't. */}
          <TabsContent value="trends" className="min-h-0 flex-1 overflow-auto">
            <div className="grid h-full min-h-[36rem] grid-cols-2 grid-rows-[3fr_2fr] gap-3">
              <div className="col-span-2 min-h-0">
                <ChartCard
                  title="Cumulative throughput & net profit"
                  hint="The two scores together: money made through sales as a running total, and the same money net of operating expense and carrying cost. The gap between the lines is what the doors being open cost; net crossing the dashed zero is the run turning profitable — output can look healthy while net still falls."
                >
                  <TickSeriesChart
                    data={charts.cumulative}
                    yLabel="Cumulative ($)"
                    tooltipLabel="Throughput"
                    secondaryLabel="Net profit"
                    zeroLine
                    formatValue={formatSignedCents}
                    formatAxis={(cents) => (cents / 100).toFixed(0)}
                  />
                </ChartCard>
              </div>
              <div className="min-h-0">
                <ChartCard
                  title="Throughput rate"
                  hint="How fast the run is earning right now: the same money as a trailing rate over the last simulated minute. Bursts and stalls show directly, where the cumulative curve only bends."
                >
                  <TickSeriesChart
                    data={charts.rate}
                    yLabel="Rate ($/min)"
                    tooltipLabel="Rate"
                    formatValue={(cents) => `${formatCents(cents)}/min`}
                    formatAxis={(cents) => (cents / 100).toFixed(0)}
                    stroke="var(--chart-2)"
                  />
                </ChartCard>
              </div>
              <div className="min-h-0">
                <ChartCard
                  title="Work in process"
                  hint="Parts released but not yet finished, per tick. Rising WIP against a flat rate means parts are piling up at a constraint rather than flowing — the floor tab shows where."
                >
                  <TickSeriesChart
                    data={charts.wip}
                    yLabel="WIP (parts)"
                    tooltipLabel="WIP"
                    formatValue={(parts) => `${parts.toLocaleString()} parts`}
                    formatAxis={(parts) => String(parts)}
                    stroke="var(--chart-3)"
                    type="stepAfter"
                  />
                </ChartCard>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="dashboard" className="flex min-h-0 flex-1 flex-col">
            {metrics ? (
              <RunDashboard
                metrics={metrics}
                // `/metrics` carries work center ids and no names or capacities
                // — the floor's frozen copy is where both come from
                centers={floor?.workCenters ?? []}
                tickNum={run.tickNum}
                dayTicks={run.dayTicks}
                onWindow={(fromTick, toTick) =>
                  loadMetrics(run.id, fromTick, toTick)
                }
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                No metrics yet — advance the run to observe some ticks.
              </p>
            )}
          </TabsContent>
        </Tabs>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed">
          <p className="text-sm text-muted-foreground">
            {isLoading
              ? "Loading…"
              : "Create a run to put this factory to work."}
          </p>
        </div>
      )}

      {jump && showOverlay && (
        <SimulatingOverlay
          label={jump.label}
          ticksDone={jump.ticksDone}
          ticksTotal={jump.ticksTotal}
          tickNum={jump.tickNum}
          // a jump inside one chunk has nothing to report until it is done, so
          // it pulses rather than snapping a bar from 0 to 100
          determinate={jump.ticksTotal !== null && jump.ticksTotal > CHUNK_TICKS}
          stopping={stopping}
          onStop={() => {
            stopJump.current = true;
            setStopping(true);
          }}
        />
      )}
    </div>
  );
}

export default SimulationPage;
