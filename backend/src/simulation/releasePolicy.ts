import type { Routing, WipPart } from "./types.js";

/**
 * Release policies (Track RP): when the run itself puts the next work order on
 * the floor, so a fast-forward doesn't drain the floor and burn rent on an
 * idle factory. Pure — the planner is a function of the tick, the floor and
 * the backlog, with no RNG and no clock of its own, which is what keeps a
 * policy-driven run reproducible from its seed.
 *
 * Priority is the same everywhere: earliest due date first, undated orders
 * last, work-order id as the tie-break. The playground seed's work-order ids
 * happen to ascend in due-date order, so tests of the ordering must use
 * fixtures where the two disagree.
 */
export type ReleasePolicy =
  | { kind: "manual" }
  | { kind: "conwip"; wipCap: number }
  | { kind: "due_date"; leadTicks: number }
  | { kind: "dbr"; drumWorkCenterId: number; drumBuffer: number };

/**
 * The run row's five frozen policy columns as the engine's discriminated
 * union. Lead days become ticks here — the engine never sees calendar days,
 * the same boundary rule as `dueAtTick`. Throws rather than falling back to
 * manual: a dbr run with no drum, or a policy string this build doesn't know,
 * would otherwise read as a policy that quietly lost money.
 */
export function policyFromRun(row: {
  releasePolicy: string;
  wipCap: number;
  releaseLeadDays: number;
  drumWorkCenterId: number | null;
  drumBuffer: number;
  dayTicks: number;
}): ReleasePolicy {
  switch (row.releasePolicy) {
    case "manual":
      return { kind: "manual" };
    case "conwip":
      return { kind: "conwip", wipCap: row.wipCap };
    case "due_date":
      return { kind: "due_date", leadTicks: row.releaseLeadDays * row.dayTicks };
    case "dbr":
      if (row.drumWorkCenterId === null) {
        throw new Error(
          "Run uses drum-buffer-rope but names no drum work center",
        );
      }
      return {
        kind: "dbr",
        drumWorkCenterId: row.drumWorkCenterId,
        drumBuffer: row.drumBuffer,
      };
    default:
      throw new Error(`Unknown release policy "${row.releasePolicy}"`);
  }
}

/** One unreleased work order, as the planner sees it. */
export type BacklogOrder = {
  workOrderId: number;
  quantity: number;
  /** earliest covering promise in run ticks; null = no promise */
  dueAtTick: number | null;
  /** every work center the order's pinned-to-be routing visits */
  workCenterIds: ReadonlySet<number>;
};

/** The slice of `RunState` a release decision reads. */
export type ReleaseView = {
  tickNum: number;
  wipParts: readonly WipPart[];
  routingByWorkOrder: ReadonlyMap<number, Routing>;
};

/** EDD: earliest due first, undated last, id tie-break. */
function byDueThenId(a: BacklogOrder, b: BacklogOrder): number {
  if (a.dueAtTick === null && b.dueAtTick === null) {
    return a.workOrderId - b.workOrderId;
  }
  if (a.dueAtTick === null) return 1;
  if (b.dueAtTick === null) return -1;
  return a.dueAtTick - b.dueAtTick || a.workOrderId - b.workOrderId;
}

/**
 * Which orders to release right now, in release order. Deterministic, and
 * evaluated only *between* batches — an order becoming eligible mid-batch
 * releases at the next evaluation, which bounds a release's lateness at one
 * batch (an hour in a jump, a beat live).
 *
 * - **conwip**: fill the floor to `wipCap`, counting each released order's
 *   quantity toward the cap as it is planned — whole orders, so the last one
 *   may overshoot the cap, but one evaluation can never dump the book.
 * - **due_date**: release every dated order inside its lead window
 *   (`tickNum >= dueAtTick − leadTicks`); an already-late order releases
 *   immediately. Undated orders never auto-release — there is no date to
 *   lead — and stay manually releasable.
 * - **dbr**: the rope. Count on-floor parts whose *current* step runs at the
 *   drum (queued and in service — a part past the drum no longer loads it),
 *   and fill drum-visiting orders to `drumBuffer`, counting quantities like
 *   conwip. Orders whose routing never visits the drum release immediately:
 *   they can't contend for the constraint, and holding them back starves
 *   throughput they earn for free — their carrying cost is the visible price
 *   of that call.
 */
export function planReleases(
  policy: ReleasePolicy,
  view: ReleaseView,
  backlog: readonly BacklogOrder[],
): number[] {
  if (policy.kind === "manual" || backlog.length === 0) return [];
  const queue = [...backlog].sort(byDueThenId);

  switch (policy.kind) {
    case "conwip": {
      const planned: number[] = [];
      let wip = view.wipParts.length;
      for (const order of queue) {
        if (wip >= policy.wipCap) break;
        planned.push(order.workOrderId);
        wip += order.quantity;
      }
      return planned;
    }
    case "due_date": {
      return queue
        .filter(
          (order) =>
            order.dueAtTick !== null &&
            view.tickNum >= order.dueAtTick - policy.leadTicks,
        )
        .map((order) => order.workOrderId);
    }
    case "dbr": {
      let drumWip = 0;
      for (const part of view.wipParts) {
        const step = view.routingByWorkOrder.get(part.workOrderId)?.steps[
          part.stepIndex
        ];
        if (step !== undefined && step.workCenterId === policy.drumWorkCenterId) {
          drumWip += 1;
        }
      }
      const planned: number[] = [];
      for (const order of queue) {
        if (!order.workCenterIds.has(policy.drumWorkCenterId)) {
          planned.push(order.workOrderId);
          continue;
        }
        if (drumWip >= policy.drumBuffer) continue;
        planned.push(order.workOrderId);
        drumWip += order.quantity;
      }
      return planned;
    }
  }
}

/**
 * How many backlog orders this policy could *ever* release on its own — what
 * a jump's drain-stop needs. Under `due_date` undated orders don't count, or
 * a jump would advance forever waiting on a release that can never come;
 * under `manual` nothing counts, since the policy releases nothing.
 */
export function eligibleBacklogCount(
  policy: ReleasePolicy,
  backlog: readonly BacklogOrder[],
): number {
  switch (policy.kind) {
    case "manual":
      return 0;
    case "due_date":
      return backlog.filter((order) => order.dueAtTick !== null).length;
    default:
      return backlog.length;
  }
}
