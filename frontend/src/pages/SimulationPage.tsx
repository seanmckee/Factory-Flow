import { useCallback, useEffect, useRef, useState } from "react";
import WorkCenterCard from "../components/WorkCenterCard";
import ThroughputChart from "../components/ThroughputChart";
import { cumulativeThroughput } from "../simulation/cumulativeThroughput";
import { ApiError, getJson } from "../api/client";
import {
  advanceRun,
  createRun,
  deleteRun,
  getRun,
  getRunFloor,
  getRunTicks,
  listRuns,
  releaseWorkOrder,
  type Run,
  type RunFloor,
  type RunSummary,
  type TickSample,
} from "../api/runs";
import type { WorkOrder } from "../types/WorkOrder";
import { useToast } from "../toast/ToastContext";
import { inputClass } from "../components/ui/Form";

/** One tick is one simulated second, so ticking once a second runs real-time. */
const TICK_INTERVAL_MS = 1000;

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

  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [newRunName, setNewRunName] = useState("");

  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

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
  }, []);

  useEffect(() => {
    if (runId === null) return;
    let cancelled = false;
    async function load(id: number) {
      try {
        await refresh(id);
      } catch (error) {
        if (!cancelled) report(error, "Failed to load run");
      }
    }
    load(runId);
    return () => {
      cancelled = true;
    };
  }, [runId, refresh, report]);

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

  const cumulative = cumulativeThroughput(
    series.map((sample) => ({ tick: sample.tickNum, cents: sample.throughputCents })),
  );
  const workOrderById = new Map(workOrders.map((wo) => [wo.id, wo]));

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
          className="bg-slate-700 text-white p-2 rounded-lg"
          onClick={onCreateRun}
        >
          Create Run
        </button>
        <button
          className="bg-red-600 text-white p-2 rounded-lg disabled:opacity-40"
          onClick={onDeleteRun}
          disabled={runId === null}
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

      <div className="flex gap-4">
        <button
          className="bg-blue-500 text-white p-2 rounded-lg disabled:opacity-40"
          onClick={() => setIsRunning((prev) => !prev)}
          disabled={runId === null}
        >
          {isRunning ? "Stop Simulation" : "Start Simulation"}
        </button>

        <button
          className="bg-green-500 text-white p-2 rounded-lg disabled:opacity-40"
          onClick={onRelease}
          disabled={runId === null}
        >
          Release Order
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
    </div>
  );
}

export default SimulationPage;
