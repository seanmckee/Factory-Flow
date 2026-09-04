import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, getJson } from "../api/client";
import {
  advanceRun,
  applyCapitalAction,
  createRun,
  deleteRun,
  getRun,
  getRunFloor,
  getRunMetrics,
  getRunTicks,
  listCapitalActions,
  listRuns,
  releaseWorkOrder,
  unlockRun,
  type CapitalAction,
  type CapitalActionKind,
  type Run,
  type RunFloor,
  type RunMetrics,
  type RunSummary,
  type TickSample,
} from "../api/runs";
import { CAPITAL_LABELS, formatSpend } from "./capital";
import { cumulativeThroughput, openingCents } from "./cumulativeThroughput";
import { netPerTick, openingNetCents } from "./netProfit";
import { chartBucket, formatTickTime, TICKS_PER_DAY } from "./simTime";
import { trailingRate } from "./throughputRate";
import { useToast } from "../toast/ToastContext";
import type { SalesOrder } from "../types/SalesOrder";
import type { WorkOrder } from "../types/WorkOrder";

const TICK_INTERVAL_MS = 1000;
const CLOCK_TICKS_PER_BEAT = 60;
const CHUNK_TICKS = 3600;

export const JUMP_PRESETS = [
  { label: "+1 hour", ticks: 3_600 },
  { label: "+4 hours", ticks: 4 * 3_600 },
  { label: "+1 day", ticks: TICKS_PER_DAY },
];

export type JumpProgress = {
  label: string;
  ticksDone: number;
  ticksTotal: number;
  tickNum: number | null;
};

export type ActiveTab = "floor" | "trends" | "dashboard";
type PendingAction = "create" | "delete" | "release" | "capital" | null;

/** Coordinates the server-backed run while keeping rendering concerns out of the page. */
export function useSimulationPage() {
  const { showToast } = useToast();
  const [runs, setRuns] = useState<Run[]>([]);
  const [runId, setRunId] = useState<number | null>(null);
  const [run, setRun] = useState<RunSummary | null>(null);
  const [floor, setFloor] = useState<RunFloor | null>(null);
  const [series, setSeries] = useState<TickSample[]>([]);
  const [seriesBucket, setSeriesBucket] = useState(1);
  const [metrics, setMetrics] = useState<RunMetrics | null>(null);
  const [actions, setActions] = useState<CapitalAction[]>([]);
  const [capitalOpen, setCapitalOpen] = useState(false);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [newRunName, setNewRunName] = useState("");
  const [newRunOpen, setNewRunOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunLoading, setIsRunLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("floor");
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [jump, setJump] = useState<JumpProgress | null>(null);
  const [stopping, setStopping] = useState(false);
  const stopJumpRef = useRef(false);
  const advancing = useRef(false);

  const report = useCallback(
    (error: unknown, fallback: string) => {
      showToast(error instanceof ApiError ? error.message : fallback, "error");
    },
    [showToast],
  );

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

  const refresh = useCallback(async (id: number) => {
    const [summary, runFloor] = await Promise.all([getRun(id), getRunFloor(id)]);
    setRun(summary);
    setFloor(runFloor);
    setRuns((previous) =>
      previous.map((option) =>
        option.id === summary.id
          ? { ...option, tickNum: summary.tickNum, status: summary.status }
          : option,
      ),
    );
  }, []);

  const loadSeries = useCallback(
    async (id: number, tickNum: number) => {
      setSeriesLoading(true);
      try {
        const bucket = chartBucket(tickNum);
        setSeries(await getRunTicks(id, bucket));
        setSeriesBucket(bucket);
      } catch (error) {
        report(error, "Failed to load trends");
      } finally {
        setSeriesLoading(false);
      }
    },
    [report],
  );

  const loadMetrics = useCallback(
    async (id: number, fromTick?: number, toTick?: number) => {
      setMetricsLoading(true);
      try {
        setMetrics(await getRunMetrics(id, fromTick, toTick));
      } catch (error) {
        report(error, "Failed to load run metrics");
      } finally {
        setMetricsLoading(false);
      }
    },
    [report],
  );

  /**
   * The run's capital log. Deliberately not on the clock's beat: it changes
   * only when an action is applied, so it loads with the dashboard and again
   * after each action.
   */
  const loadActions = useCallback(
    async (id: number) => {
      try {
        setActions(await listCapitalActions(id));
      } catch (error) {
        report(error, "Failed to load the capital log");
      }
    },
    [report],
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [runList, orders, demand] = await Promise.all([
          listRuns(),
          getJson<WorkOrder[]>("/api/work-orders"),
          getJson<SalesOrder[]>("/api/sales-orders"),
        ]);
        if (cancelled) return;
        setRuns(runList);
        setWorkOrders(orders);
        setSalesOrders(demand);
        const latest = runList.at(-1);
        if (latest) {
          setIsRunLoading(true);
          setRunId(latest.id);
        }
      } catch (error) {
        if (!cancelled) report(error, "Failed to load runs");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [report]);

  const selectRun = useCallback((id: number | null) => {
    setIsRunning(false);
    setRunId(id);
    setIsRunLoading(id !== null);
    setSelectedOrderId(null);
    setRun(null);
    setFloor(null);
    setSeries([]);
    setMetrics(null);
    setActions([]);
    setActiveTab("floor");
  }, []);

  useEffect(() => {
    if (runId === null) return;
    let cancelled = false;
    async function load(id: number) {
      try {
        await refresh(id);
      } catch (error) {
        if (!cancelled) report(error, "Failed to load run");
      } finally {
        if (!cancelled) setIsRunLoading(false);
      }
    }
    void load(runId);
    return () => {
      cancelled = true;
    };
  }, [runId, refresh, report]);

  useEffect(() => {
    if (!isRunning || runId === null) return;
    const interval = setInterval(async () => {
      if (advancing.current) return;
      advancing.current = true;
      try {
        await advanceRun(runId, CLOCK_TICKS_PER_BEAT);
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

  const awaitIdleClock = useCallback(async () => {
    for (let attempt = 0; advancing.current && attempt < 40; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return !advancing.current;
  }, []);

  const runJump = useCallback(
    async (target: number, jumpLabel: string) => {
      if (runId === null) return showToast("Create or select a run first", "error");
      if (jump) return;
      if ((run?.wipCount ?? 0) === 0) {
        return showToast("Nothing on the floor — release a work order first", "error");
      }
      setIsRunning(false);
      if (!(await awaitIdleClock())) {
        return showToast("The run is still advancing — try again", "error");
      }

      const label = `Advancing ${jumpLabel}`;
      const startTick = run?.tickNum ?? 0;
      advancing.current = true;
      stopJumpRef.current = false;
      setStopping(false);
      setJump({ label, ticksDone: 0, ticksTotal: target, tickNum: null });

      let done = 0;
      try {
        while (done < target && !stopJumpRef.current) {
          const size = Math.min(CHUNK_TICKS, target - done);
          const result = await advanceRun(runId, size);
          done += result.ticksAdvanced;
          setJump({ label, ticksDone: done, ticksTotal: target, tickNum: result.tickNum });
          try {
            await refresh(runId);
          } catch (error) {
            report(error, "Failed to load run");
          }
          if (result.wipCount === 0) {
            showToast(
              `Floor emptied at ${formatTickTime(result.tickNum, run?.dayTicks ?? TICKS_PER_DAY)} — stopped the jump`,
            );
            break;
          }
        }
      } catch (error) {
        reportAdvance(error, runId);
      } finally {
        setJump(null);
        setStopping(false);
        advancing.current = false;
      }
      if (done > 0) await loadMetrics(runId, startTick + 1, startTick + done);
      if (done > 0 && activeTab === "trends") {
        await loadSeries(runId, startTick + done);
      }
    },
    [runId, jump, run, awaitIdleClock, refresh, report, reportAdvance, showToast, loadMetrics, activeTab, loadSeries],
  );

  const onCreateRun = async () => {
    const name = newRunName.trim();
    if (!name) return showToast("Name the run", "error");
    setPendingAction("create");
    try {
      const created = await createRun(name);
      setRuns((previous) => [...previous, created]);
      selectRun(created.id);
      setNewRunName("");
      setNewRunOpen(false);
      showToast(`Run "${created.name}" created with seed ${created.rngSeed}`);
    } catch (error) {
      report(error, "Failed to create the run");
    } finally {
      setPendingAction(null);
    }
  };

  const onDeleteRun = async () => {
    if (runId === null) return;
    setPendingAction("delete");
    try {
      const deleted = await deleteRun(runId);
      const remaining = runs.filter((option) => option.id !== deleted.id);
      setRuns(remaining);
      selectRun(remaining.at(-1)?.id ?? null);
      showToast(`Deleted run "${deleted.name}"`);
    } catch (error) {
      report(error, "Failed to delete the run");
    } finally {
      setPendingAction(null);
    }
  };

  const onRelease = async () => {
    if (runId === null) return showToast("Create or select a run first", "error");
    if (selectedOrderId === null) return showToast("Select a work order to release", "error");
    setPendingAction("release");
    if (!(await awaitIdleClock())) {
      setPendingAction(null);
      return showToast("The run is still advancing — try again", "error");
    }
    advancing.current = true;
    try {
      const released = await releaseWorkOrder(runId, selectedOrderId);
      setSelectedOrderId(null);
      await refresh(runId);
      showToast(`Released ${released.partsReleased} parts at tick ${released.releasedAtTick}`);
    } catch (error) {
      report(error, "Failed to release the work order");
    } finally {
      advancing.current = false;
      setPendingAction(null);
    }
  };

  /**
   * Buys, retires, hires or lets go — the only thing that edits a run's own
   * frozen config. Waits the clock's beat out and holds `advancing` exactly as
   * releasing does: all three contend for the same server-side lock, and
   * colliding would raise the 409 the unlock button exists to cure.
   */
  const onCapitalAction = useCallback(
    async (kind: CapitalActionKind, workCenterId: number) => {
      if (runId === null) return showToast("Create or select a run first", "error");
      if (jump) return;
      setPendingAction("capital");
      if (!(await awaitIdleClock())) {
        setPendingAction(null);
        return showToast("The run is still advancing — try again", "error");
      }
      advancing.current = true;
      try {
        const applied = await applyCapitalAction(runId, kind, workCenterId);
        await refresh(runId);
        await loadActions(runId);
        const name =
          floor?.workCenters.find((center) => center.workCenterId === workCenterId)
            ?.name ?? `WC ${workCenterId}`;
        showToast(
          `${CAPITAL_LABELS[kind]} at ${name} — ${formatSpend(applied.spendCents)}, now ${applied.machinesAfter} machine${
            applied.machinesAfter === 1 ? "" : "s"
          } / ${applied.operatorsAfter} operator${applied.operatorsAfter === 1 ? "" : "s"}`,
        );
      } catch (error) {
        report(error, "Failed to apply the action");
      } finally {
        advancing.current = false;
        setPendingAction(null);
      }
    },
    [runId, jump, awaitIdleClock, refresh, loadActions, floor, report, showToast],
  );

  const trend = useMemo(() => {
    const history = series.map((sample) => ({ tick: sample.tickNum, cents: sample.throughputCents }));
    const pnlHistory = series.map((sample) => ({
      tick: sample.tickNum,
      throughputCents: sample.throughputCents,
      operatingExpenseCents: sample.operatingExpenseCents,
      carryingCostCents: sample.carryingCostCents,
      wageCents: sample.wageCents,
      capitalSpendCents: sample.capitalSpendCents,
    }));
    const cumulative = cumulativeThroughput(history, openingCents(history, run?.throughputCents ?? 0));
    const net = cumulativeThroughput(netPerTick(pnlHistory), openingNetCents(pnlHistory, run?.netCents ?? 0));
    const rate = trailingRate(history, seriesBucket);
    return series.map((sample, index) => ({
      tick: sample.tickNum,
      throughput: cumulative[index]?.cents ?? 0,
      net: net[index]?.cents ?? 0,
      rate: rate[index]?.cents ?? 0,
      wip: sample.wipCount,
    }));
  }, [series, seriesBucket, run?.throughputCents, run?.netCents]);

  const workOrderById = useMemo(() => new Map(workOrders.map((order) => [order.id, order])), [workOrders]);
  const releasedIds = useMemo(
    () => new Set((run?.releasedOrders ?? []).map((item) => item.workOrderId)),
    [run?.releasedOrders],
  );
  const releasableOrders = useMemo(
    () => workOrders.filter((order) => !releasedIds.has(order.id)),
    [workOrders, releasedIds],
  );

  const changeTab = (next: ActiveTab) => {
    setActiveTab(next);
    if (next === "trends" && runId !== null && run) void loadSeries(runId, run.tickNum);
    else if (next === "dashboard" && runId !== null) {
      if (!metrics) void loadMetrics(runId);
      void loadActions(runId);
    }
  };

  return {
    actions, activeTab, capitalOpen, changeTab, floor, isLoading, isRunLoading,
    isRunning, jump,
    loadMetrics, metrics, metricsLoading, newRunName, newRunOpen, onCapitalAction,
    onCreateRun,
    onDeleteRun, onRelease, pendingAction, releasableOrders, run, runId, runs,
    runJump, salesOrders, selectRun, selectedOrderId, seriesLoading, setCapitalOpen,
    setIsRunning,
    setNewRunName, setNewRunOpen, setSelectedOrderId, setStopping, stopping,
    stopJumpRef, trend, workOrderById,
  };
}

export type SimulationPageController = ReturnType<typeof useSimulationPage>;
