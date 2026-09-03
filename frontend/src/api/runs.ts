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

export const releaseWorkOrder = (runId: number, workOrderId: number) =>
  postJson<ReleaseResult>(`/api/runs/${runId}/releases`, { workOrderId });

export const advanceRun = (runId: number, ticks: number) =>
  postJson<AdvanceResult>(`/api/runs/${runId}/advance`, { ticks });

export const deleteRun = (runId: number) =>
  deleteJson<{ id: number; name: string }>(`/api/runs/${runId}`);
