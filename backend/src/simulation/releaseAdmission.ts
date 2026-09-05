import type { RunState } from "./simulateBatch.js";
import {
  PROCESS_TIME_DEVIATION,
  sampleProcessTime,
} from "./sampleProcessTime.js";
import type {
  Allocation,
  Part,
  RoutingStep,
  SalesOrder,
  WipPart,
  WorkOrder,
} from "./types.js";

/**
 * Turning a planned release into engine state, shared by the manual release
 * and the auto-release path so the two cannot drift: `buildReleaseParts` is
 * the one place a release's WIP parts are constructed, and the draw is the
 * same `(seed, workOrderId, unitIndex, stepIndex)` key either way — an
 * auto-released part rolls the dice a manual release of the same order would
 * have rolled.
 */
export function buildReleaseParts(
  run: { rngSeed: number; tickNum: number },
  workOrderId: number,
  quantity: number,
  firstStepProcessTimeSeconds: number,
): WipPart[] {
  return Array.from({ length: quantity }, (_, unitIndex) => ({
    // row identity only, never a draw input — a fresh uuid per release must
    // not mean the seed didn't determine the run
    id: crypto.randomUUID(),
    workOrderId,
    unitIndex,
    releasedAtTick: run.tickNum,
    stepIndex: 0,
    progressSeconds: 0,
    actualProcessTimeSeconds: sampleProcessTime(
      firstStepProcessTimeSeconds,
      PROCESS_TIME_DEVIATION,
      { seed: run.rngSeed, workOrderId, unitIndex, stepIndex: 0 },
    ),
  }));
}

/**
 * Everything `admitOrderIntoState` must graft onto a `RunState` for the
 * engine not to throw on the new parts: the pinned steps
 * (`simulateTick` throws on a part with no routing), the work order and its
 * part (`materialCostByWorkOrder` throws on a missing one), and the covering
 * demand (a missing sales order silently credits zero, which is worse).
 */
export type AdmittableOrder = {
  workOrderId: number;
  steps: RoutingStep[];
  workOrder: WorkOrder;
  part: Part;
  salesOrders: SalesOrder[];
  allocations: Allocation[];
};

/**
 * A new state with `order`'s release grafted on. Parts append at the **end**:
 * admission is list order, so a release queues behind everything already on
 * the floor, exactly as a manual release lands behind existing WIP rows.
 * Parts and sales orders dedupe by id — several work orders can share a part
 * or be covered by one sales order — while allocation rows are distinct by
 * construction and `creditFinishedParts` orders them by id itself.
 */
export function admitOrderIntoState(
  state: RunState,
  order: AdmittableOrder,
  parts: WipPart[],
): RunState {
  const routingByWorkOrder = new Map(state.routingByWorkOrder);
  routingByWorkOrder.set(order.workOrderId, { steps: order.steps });

  const knownParts = new Set(state.parts.map((part) => part.id));
  const knownSalesOrders = new Set(state.salesOrders.map((so) => so.id));

  return {
    ...state,
    wipParts: [...state.wipParts, ...parts],
    routingByWorkOrder,
    workOrders: [...state.workOrders, order.workOrder],
    parts: knownParts.has(order.part.id)
      ? state.parts
      : [...state.parts, order.part],
    salesOrders: [
      ...state.salesOrders,
      ...order.salesOrders.filter((so) => !knownSalesOrders.has(so.id)),
    ],
    allocations: [...state.allocations, ...order.allocations],
  };
}
