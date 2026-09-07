import { deleteJson, getJson, postJson } from "./client";
import type { ReleasePolicyKind } from "../simulation/releasePolicy";

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
  /** the run's own frozen release policy (RP); changed via setReleasePolicy */
  releasePolicy: ReleasePolicyKind;
  wipCap: number;
  releaseLeadDays: number;
  drumWorkCenterId: number | null;
  drumBuffer: number;
  /** the run's frozen day length in ticks — what its per-day rates accrue over */
  dayTicks: number;
  /** frozen facility-level rates, for display; the accrual happened server-side */
  facilityOverheadCentsPerDay: number;
  wipCarryingBpsPerDay: number;
};

export type RunSummary = Run & {
  wipCount: number;
  finishedCount: number;
  /** every finished unit's frozen throughput, summed */
  throughputCents: number;
  /** every tick's frozen expense, summed */
  operatingExpenseCents: number;
  carryingCostCents: number;
  /** operator pay, summed from the same frozen tick column */
  wageCents: number;
  /**
   * Capital spent on machines and hires, summed from the frozen action rows —
   * salvage is a negative spend, so churning a machine shows as the loss it
   * was. Charged as a lump at the tick it happened, not accrued per tick.
   */
  capitalSpendCents: number;
  /**
   * throughput − expense − carrying − wages − capital: the score, can be
   * negative
   */
  netCents: number;
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
  /** effective capacity — `min(machines, operators)`, what admits a part */
  capacity: number;
  /** the two it is the lesser of: a machine nobody staffs runs nothing */
  machines: number;
  operators: number;
  /** frozen, per **machine** — the centre's rent is machines × this */
  standingCostCentsPerDay: number;
  /** frozen per-operator hourly wage */
  wageCentsPerHour: number;
  /** the run's frozen capital prices: what an action here costs it */
  machinePurchaseCents: number;
  machineSalvageCents: number;
  operatorHireCents: number;
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
  operatingExpenseCents: number;
  carryingCostCents: number;
  wageCents: number;
  /** capital charged on this tick (or in this bucket) — a lump, not a rate */
  capitalSpendCents: number;
};

export type AdvanceResult = {
  tickNum: number;
  ticksAdvanced: number;
  throughputCents: number;
  operatingExpenseCents: number;
  carryingCostCents: number;
  wageCents: number;
  /** units ruined by scrap draws over the advance */
  scrappedCount: number;
  /** WIP still on the floor after the advance — an agent's stop condition. */
  wipCount: number;
  /** what the release policy put on the floor during the advance, in order */
  autoReleased: {
    workOrderId: number;
    partsReleased: number;
    releasedAtTick: number;
  }[];
  /**
   * Orders the policy could still release. A jump drains only when
   * `wipCount === 0 && backlogCount === 0` — always 0 under manual, so the
   * old drain condition is this one's special case.
   */
  backlogCount: number;
};

/** One work center's rates over a window. Utilization is in [0, 1]. */
export type WorkCenterAggregate = {
  workCenterId: number;
  /** Busy machine-ticks / capacity-ticks. 1 is the constraint. */
  utilization: number;
  busyMachineTicks: number;
  /** machine-ticks available: each tick's own capacity, summed */
  capacityTicks: number;
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
  /** the window's frozen per-tick expense, summed like its throughput */
  operatingExpenseCents: number;
  carryingCostCents: number;
  wageCents: number;
  /** capital spent in the window, windowed on the action's own tick */
  capitalSpendCents: number;
  netCents: number;
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
  /**
   * The window's finishes against their promises. Only units credited to an
   * order with a due date are measured, so `onTimeFraction` is null when no
   * promise was measured — "no promises" is not "100% kept" — and the lateness
   * stats cover late units only, null when every measured unit was on time.
   */
  onTimeDelivery: {
    measuredCount: number;
    onTimeCount: number;
    lateCount: number;
    onTimeFraction: number | null;
    meanLatenessSeconds: number | null;
    maxLatenessSeconds: number | null;
  };
  /**
   * The same finishes per covering sales order, sorted by order id. Names and
   * quantities join client-side from the live sales orders, as work-centre
   * names come off /floor — /metrics carries ids.
   */
  salesOrderDelivery: SalesOrderDelivery[];
  /** the window's ruined units, with the material they consumed frozen */
  scrap: {
    scrappedCount: number;
    scrappedMaterialCents: number;
  };
};

export type SalesOrderDelivery = {
  salesOrderId: number;
  /** from the order's latest-finished unit; null = the order never promised */
  dueAtTick: number | null;
  lastCompletedAtTick: number;
  /** units credited in the window — measuredCount is 0 for an undated order */
  finishedCount: number;
  delivery: RunMetrics["onTimeDelivery"];
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

/**
 * Copies the run at its current tick into a new run (Track 7). Everything but
 * the name is the parent's — seed, frozen config, floor, history — so the
 * branches replay identically until a decision diverges them. Name omitted
 * means the server derives one from the parent and the fork day.
 */
/**
 * Changes the run's own release policy — under the run's lock (409 during a
 * jump), effective from the next advance. Omitted numeric fields keep the
 * run's current values.
 */
export const setReleasePolicy = (
  runId: number,
  body: {
    releasePolicy: ReleasePolicyKind;
    wipCap?: number;
    releaseLeadDays?: number;
    drumWorkCenterId?: number | null;
    drumBuffer?: number;
  },
) => postJson<Run>(`/api/runs/${runId}/policy`, body);

export const forkRun = (runId: number, name?: string) =>
  postJson<Run>(
    `/api/runs/${runId}/fork`,
    name === undefined ? {} : { name },
  );

export const getRun = (runId: number) =>
  getJson<RunSummary>(`/api/runs/${runId}`);

export const getRunFloor = (runId: number) =>
  getJson<RunFloor>(`/api/runs/${runId}/floor`);

/** `bucket` groups the series server-side — money summed, WIP at bucket end. */
export const getRunTicks = (runId: number, bucket = 1) =>
  getJson<TickSample[]>(
    bucket > 1
      ? `/api/runs/${runId}/ticks?bucket=${bucket}`
      : `/api/runs/${runId}/ticks`,
  );

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

export type CapitalActionKind =
  | "buy_machine"
  | "retire_machine"
  | "hire_operator"
  | "fire_operator";

export type CapitalAction = {
  id: number;
  kind: CapitalActionKind;
  workCenterId: number;
  appliedAtTick: number;
  /** frozen; positive is money out, negative is salvage coming back */
  spendCents: number;
  machinesAfter: number;
  operatorsAfter: number;
};

/**
 * Buys, retires, hires or lets go against the run's **own** frozen config —
 * the only thing in the API that edits it. The price is the run's frozen one,
 * so nothing is sent but the kind and the centre. Takes the run's lock, so it
 * 409s mid-advance exactly as a release does.
 */
export const applyCapitalAction = (
  runId: number,
  kind: CapitalActionKind,
  workCenterId: number,
) =>
  postJson<CapitalAction>(`/api/runs/${runId}/actions`, { kind, workCenterId });

export const listCapitalActions = (runId: number) =>
  getJson<CapitalAction[]>(`/api/runs/${runId}/actions`);

export const deleteRun = (runId: number) =>
  deleteJson<{ id: number; name: string }>(`/api/runs/${runId}`);
