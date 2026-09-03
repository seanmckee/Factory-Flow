import { useCallback, useEffect, useRef, useState } from "react";
import WorkCenterCard from "../components/WorkCenterCard";
import SimulatingOverlay from "../components/SimulatingOverlay";
import RunMetricsStrip from "../components/RunMetricsStrip";
import ThroughputChart from "../components/ThroughputChart";
import {
  cumulativeThroughput,
  openingCents,
} from "../simulation/cumulativeThroughput";
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
  type Run,
  type RunFloor,
  type RunMetrics,
  type RunSummary,
  type TickSample,
} from "../api/runs";
import type { WorkOrder } from "../types/WorkOrder";
import { useToast } from "../toast/ToastContext";
import { inputClass } from "../components/ui/Form";

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
        report(error, "Failed to advance the run");
      } finally {
        advancing.current = false;
      }
    }, TICK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isRunning, runId, refresh, report]);

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
        report(error, "Failed to advance the run");
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
    [runId, run, jump, awaitIdleClock, refresh, loadMetrics, report, showToast],
  );

  const onCreateRun = async () => {
    const name = newRunName.trim();
    if (!name) return showToast("Name the run", "error");
    try {
      const created = await createRun(name);
      setRuns((prev) => [...prev, created]);
      selectRun(created.id);
      setNewRunName("");
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
    try {
      const released = await releaseWorkOrder(runId, selectedOrderId);
      await refresh(runId);
      showToast(
        `Released ${released.partsReleased} parts at tick ${released.releasedAtTick}`,
      );
    } catch (error) {
      report(error, "Failed to release the work order");
    }
  };

  // `/ticks` keeps only the newest 5000 rows, so past tick 5000 this series is
  // a suffix of the run: the curve carries on from what the run had already
  // earned rather than re-basing at zero and contradicting the money above it.
  const history = series.map((sample) => ({
    tick: sample.tickNum,
    cents: sample.throughputCents,
  }));
  const cumulative = cumulativeThroughput(
    history,
    openingCents(history, run?.throughputCents ?? 0),
  );
  const workOrderById = new Map(workOrders.map((wo) => [wo.id, wo]));
  // `/metrics` carries work center ids and no names — a run keeps no copy of
  // them, so the floor's live names are where the strip gets them
  const centerNames = new Map(
    (floor?.workCenters ?? []).map((center) => [center.workCenterId, center.name]),
  );

  return (
    <div className="min-h-screen flex flex-col items-center gap-4 bg-slate-100 p-6">
      <h1 className="text-3xl font-bold">Factory Simulator</h1>

      <div className="flex flex-wrap gap-3 items-end justify-center">
        <label className="flex flex-col gap-1 text-sm text-slate-600">
          Run
          <select
            value={runId ?? ""}
            onChange={(e) =>
              selectRun(e.target.value ? Number(e.target.value) : null)
            }
            disabled={jump !== null}
            className={inputClass}
          >
            <option value="">No run selected</option>
            {runs.map((option) => (
              <option key={option.id} value={option.id}>
                #{option.id} · {option.name} · tick {option.tickNum}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm text-slate-600">
          New run
          <input
            value={newRunName}
            onChange={(e) => setNewRunName(e.target.value)}
            placeholder="e.g. release everything"
            className={inputClass}
          />
        </label>
        <button
          className="bg-slate-700 text-white p-2 rounded-lg disabled:opacity-40"
          onClick={onCreateRun}
          disabled={jump !== null}
        >
          Create Run
        </button>
        <button
          className="bg-red-600 text-white p-2 rounded-lg disabled:opacity-40"
          onClick={onDeleteRun}
          disabled={runId === null || jump !== null}
        >
          Delete Run
        </button>
      </div>

      {run && (
        <div className="flex gap-6 text-sm tabular-nums text-slate-700">
          <span>Tick {run.tickNum}</span>
          <span>WIP {run.wipCount}</span>
          <span>Finished {run.finishedCount}</span>
          <span>
            Throughput ${(run.throughputCents / 100).toFixed(2)}
          </span>
          <span className="text-slate-500">seed {run.rngSeed}</span>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4 items-start">
        {isLoading ? (
          <p>Loading...</p>
        ) : (
          floor?.workCenters.map((center) => (
            <WorkCenterCard key={center.workCenterId} center={center} />
          ))
        )}
      </div>

      {!isLoading && !run && (
        <p className="text-slate-500">
          Create a run to put this factory to work.
        </p>
      )}

      <div className="text-sm text-slate-600">
        {run?.releasedOrders.map((released) => {
          const wo = workOrderById.get(released.workOrderId);
          return (
            <div key={released.workOrderId}>
              {wo?.orderNumber ?? `WO ${released.workOrderId}`}
              {wo?.partName ? ` (${wo.partName})` : ""} · routing{" "}
              {released.routingId} rev {released.routingRevision}
            </div>
          );
        })}
      </div>

      {metrics && (
        <RunMetricsStrip metrics={metrics} centerNames={centerNames} />
      )}

      <div className="flex gap-4">
        <button
          className="bg-blue-500 text-white p-2 rounded-lg disabled:opacity-40"
          onClick={() => setIsRunning((prev) => !prev)}
          disabled={runId === null || jump !== null}
        >
          {isRunning ? "Stop Simulation" : "Start Simulation"}
        </button>

        <button
          className="bg-green-500 text-white p-2 rounded-lg disabled:opacity-40"
          onClick={onRelease}
          disabled={runId === null || jump !== null}
        >
          Release Order
        </button>
      </div>

      {/* Fast-forward. The clock above is for watching; these are for seeing
          where a run ends up, which is what the presets and until-idle answer. */}
      <div className="flex flex-wrap gap-2 items-center justify-center">
        <span className="text-sm text-slate-500">Fast-forward</span>
        {JUMP_TICKS.map((ticks) => (
          <button
            key={ticks}
            className="bg-slate-700 text-white px-3 py-2 rounded-lg text-sm tabular-nums disabled:opacity-40"
            onClick={() => runJump(ticks)}
            disabled={runId === null || jump !== null}
          >
            +{ticks.toLocaleString()}
          </button>
        ))}
        <button
          className="bg-indigo-600 text-white px-3 py-2 rounded-lg text-sm disabled:opacity-40"
          onClick={() => runJump("idle")}
          disabled={runId === null || jump !== null}
        >
          Run until idle
        </button>
      </div>

      <div className="w-full max-w-3xl h-80 shrink-0">
        <ThroughputChart data={cumulative} />
      </div>

      <div className="flex gap-4 items-center">
        <select
          value={selectedOrderId ?? ""}
          onChange={(e) =>
            setSelectedOrderId(e.target.value ? Number(e.target.value) : null)
          }
          className={inputClass}
        >
          <option value="">Select a work order</option>
          {workOrders.map((workOrder) => (
            <option key={workOrder.id} value={workOrder.id}>
              {workOrder.orderNumber} · {workOrder.partName} · qty{" "}
              {workOrder.quantity}
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-slate-500 max-w-2xl text-center">
        Machine counts are frozen when a run is created. Change them in Factory
        Setup and they apply to the next run.
      </p>

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
