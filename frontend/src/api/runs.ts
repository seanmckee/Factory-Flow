import { deleteJson, getJson, postJson } from "./client";

/**
 * The run API, hand-typed as every API shape in this app is — the backend's
 * types are strict and `nodenext`, the frontend is `bundler` with `strict` off,
 * so the two tsconfigs cannot share a file.
 *
 * A run is where the simulation lives now. The engine runs on the server, one
 * tick is still one simulated second, and this page drives a run rather than
 * simulating anything itself.
 */

export type Run = {
  id: number;
  name: string;
  /** `idle` or `advancing`; advancing is the lock, so a second call gets a 409 */
  status: string;
  tickNum: number;
  rngSeed: number;
  parentRunId: number | null;
  forkedAtTick: number | null;
};

export type RunSummary = Run & {
  wipCount: number;
  finishedCount: number;
  /** every finished unit's frozen throughput, summed */
  throughputCents: number;
  releasedOrders: {
    workOrderId: number;
    routingId: number;
    routingRevision: string;
  }[];
};

/** A work center as it stands right now. A snapshot, deliberately not a rate. */
export type FloorWorkCenter = {
  workCenterId: number;
  name: string;
  /** the run's own frozen capacity, not the live table's */
  capacity: number;
  partsAtStation: number;
  /** one entry per machine: percent complete, or null when idle */
  slots: (number | null)[];
  slotsInUse: number;
};

export type RunFloor = {
  tickNum: number;
  wipCount: number;
  workCenters: FloorWorkCenter[];
};

export type TickSample = {
  tickNum: number;
  throughputCents: number;
  wipCount: number;
};

export type AdvanceResult = {
  tickNum: number;
  ticksAdvanced: number;
  throughputCents: number;
  /** WIP still on the floor — what a jump running until idle stops on. */
  wipCount: number;
};

/** One work center's rates over a window. Utilization is in [0, 1]. */
export type WorkCenterAggregate = {
  workCenterId: number;
  /** Busy machine-ticks / (capacity x observed ticks). 1 is the constraint. */
  utilization: number;
  busyMachineTicks: number;
  meanQueueDepth: number;
  maxQueueDepth: number;
  /** Ticks that reported this center at all — utilization's denominator. */
  observedTicks: number;
};

/**
 * Rates over a tick window, not a snapshot. The window is the whole point: a
 * center can read 10% utilization over a run and 52% over the ticks it was
 * actually working, so the response's own `fromTick`/`toTick` are what a
 * reader has to be shown alongside the figures.
 */
export type RunMetrics = {
  fromTick: number;
  toTick: number;
  throughputCents: number;
  flow: {
    fromTick: number | null;
    toTick: number | null;
    tickCount: number;
    meanWip: number;
    maxWip: number;
    finalWip: number;
    workCenters: WorkCenterAggregate[];
  };
  cycleTime: {
    count: number;
    /** null rather than zero for a window no part finished in — zero is itself
        a reachable cycle time. */
    meanSeconds: number | null;
    minSeconds: number | null;
    maxSeconds: number | null;
    medianSeconds: number | null;
    p95Seconds: number | null;
  };
};

export type ReleaseResult = {
  workOrderId: number;
  partsReleased: number;
  releasedAtTick: number;
};

export const listRuns = () => getJson<Run[]>("/api/runs");

/** Seed omitted means the server picks one, readable back off the run. */
export const createRun = (name: string, rngSeed?: number) =>
  postJson<Run>("/api/runs", rngSeed === undefined ? { name } : { name, rngSeed });

export const getRun = (runId: number) =>
  getJson<RunSummary>(`/api/runs/${runId}`);

export const getRunFloor = (runId: number) =>
  getJson<RunFloor>(`/api/runs/${runId}/floor`);

export const getRunTicks = (runId: number) =>
  getJson<TickSample[]>(`/api/runs/${runId}/ticks`);

/**
 * Omitting the window asks for the whole run. Not called per tick: it reads
 * every tick row, every per-center row and every finished part in the window
 * and aggregates them, so it is fetched when a run is opened and when a jump
 * lands, not on the display clock's beat.
 */
export const getRunMetrics = (
  runId: number,
  fromTick?: number,
  toTick?: number,
) => {
  const query = new URLSearchParams();
  if (fromTick !== undefined) query.set("fromTick", String(fromTick));
  if (toTick !== undefined) query.set("toTick", String(toTick));
  const suffix = query.size ? `?${query}` : "";
  return getJson<RunMetrics>(`/api/runs/${runId}/metrics${suffix}`);
};

export const releaseWorkOrder = (runId: number, workOrderId: number) =>
  postJson<ReleaseResult>(`/api/runs/${runId}/releases`, { workOrderId });

/**
 * Clears a lock a dead process left behind. Not a reset — re-creating a run
 * with the same seed reproduces it exactly, so there is nothing to rewind.
 */
export const unlockRun = (runId: number) =>
  postJson<Run>(`/api/runs/${runId}/unlock`, {});

export const advanceRun = (runId: number, ticks: number) =>
  postJson<AdvanceResult>(`/api/runs/${runId}/advance`, { ticks });

export const deleteRun = (runId: number) =>
  deleteJson<{ id: number; name: string }>(`/api/runs/${runId}`);
