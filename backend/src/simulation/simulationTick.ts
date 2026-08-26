import { PROCESS_TIME_DEVIATION, sampleProcessTime } from "./sampleProcessTime.js";
import type {
  FinishedPart,
  Routing,
  RoutingStep,
  WipPart,
  WorkCenter,
} from "./types.js";

export type SimulationTickResult = {
  /** the parts still on the floor, as of the end of the tick */
  wipParts: WipPart[];
  /** only those that completed during *this* tick, not the run's history */
  finishedParts: FinishedPart[];
};

/**
 * Everything a part needs for this tick, resolved once. The frontend original
 * looked each of these up three times per part per tick and logged-and-skipped
 * when one was missing; here a missing routing or work center is a loader bug
 * or a corrupt run, so it throws and the batch of ticks rolls back rather than
 * silently freezing a part in WIP forever.
 */
type Claim = {
  part: WipPart;
  routing: Routing;
  step: RoutingStep;
  workCenter: WorkCenter;
};

function resolve(
  part: WipPart,
  routings: Map<number, Routing>,
  workCenters: Map<number, WorkCenter>,
): Claim | null {
  const routing = routings.get(part.routingId);
  if (!routing) {
    throw new Error(
      `Part ${part.id} references routing ${part.routingId}, which was not loaded`,
    );
  }
  const step = routing.steps[part.stepIndex];
  // The routing was shortened under this part: the work it was queued for no
  // longer exists, so it finishes here rather than freezing or vanishing.
  if (!step) return null;

  const workCenter = workCenters.get(step.workCenterId);
  if (!workCenter) {
    throw new Error(
      `Part ${part.id} is at work center ${step.workCenterId}, which was not loaded`,
    );
  }
  return { part, routing, step, workCenter };
}

/**
 * One simulated second. Pure: it copies the parts it is given and returns new
 * ones, so the caller decides what to persist.
 *
 * A work center runs up to `capacity` parts at once, claimed in two passes —
 * parts already mid-process hold the machine they started on, then whatever is
 * still free admits waiting parts in list order. Parts that claim nothing
 * simply don't advance; queueing is implicit, there is no queue structure.
 */
export function simulateTick(
  wipParts: WipPart[],
  routings: Map<number, Routing>,
  tickNum: number,
  workCenters: Map<number, WorkCenter>,
  rngSeed: number,
): SimulationTickResult {
  const finishedParts: FinishedPart[] = [];
  const claims: Claim[] = [];

  for (const source of wipParts) {
    const part = { ...source };
    const claim = resolve(part, routings, workCenters);
    if (!claim) {
      // stranded past the end of a shortened routing: credited now, and it
      // holds no machine on the way out
      finishedParts.push(finish(part, tickNum));
      continue;
    }
    claims.push(claim);
  }

  /** work center id -> machines occupied this tick */
  const inUse = new Map<number, number>();
  const inService = new Set<string>();

  // parts already mid-process keep the machine they started on
  for (const { part, step } of claims) {
    if (part.progressSeconds <= 0) continue;
    inService.add(part.id);
    inUse.set(step.workCenterId, (inUse.get(step.workCenterId) ?? 0) + 1);
  }

  // admit waiting parts onto whatever machines are still free
  for (const { part, step, workCenter } of claims) {
    if (inService.has(part.id)) continue;
    if ((inUse.get(step.workCenterId) ?? 0) >= workCenter.capacity) continue;
    inService.add(part.id);
    inUse.set(step.workCenterId, (inUse.get(step.workCenterId) ?? 0) + 1);
  }

  const finishedIds = new Set<string>();
  for (const { part, routing } of claims) {
    if (!inService.has(part.id)) continue;

    part.progressSeconds += 1;
    if (part.progressSeconds < part.actualProcessTimeSeconds) continue;

    part.progressSeconds = 0;
    const nextIndex = part.stepIndex + 1;
    const nextStep = routing.steps[nextIndex];
    if (!nextStep) {
      finishedParts.push(finish(part, tickNum));
      finishedIds.add(part.id);
      continue;
    }
    part.stepIndex = nextIndex;
    part.actualProcessTimeSeconds = sampleProcessTime(
      nextStep.processTimeSeconds,
      PROCESS_TIME_DEVIATION,
      { seed: rngSeed, partId: part.id, stepIndex: nextIndex },
    );
  }

  return {
    wipParts: claims
      .map((c) => c.part)
      .filter((part) => !finishedIds.has(part.id)),
    finishedParts,
  };
}

function finish(part: WipPart, tickNum: number): FinishedPart {
  return {
    id: part.id,
    workOrderId: part.workOrderId,
    completedAtTick: tickNum,
  };
}
