import type { Routing, WipPart, WorkCenter } from "./types.js";

/**
 * What one work center looks like *right now* — the shop-floor picture the
 * simulation page draws, not a rate.
 *
 * Deliberately has no `utilization`. An instantaneous `slotsInUse / capacity`
 * can only ever read 0, ½ or 1, and calling that utilization invites it being
 * read as the answer to "how busy was this center", which is
 * `aggregateMetrics`' job over a window of ticks. A caller that wants a bar
 * filled can divide.
 */
export type WorkCenterFloorView = {
  workCenterId: number;
  /** parts whose current step is here, running and waiting together */
  partsAtStation: number;
  /**
   * One entry per machine: percent complete of the part on it, or null when
   * that machine is idle. Sorted descending, so a part finishing doesn't
   * shuffle the remaining bars between rows.
   */
  slots: (number | null)[];
  slotsInUse: number;
};

/**
 * Derives the floor picture from the parts on it.
 *
 * A snapshot is the right shape here and the wrong shape for metrics: this
 * answers "what is on the floor", where utilization answers "what happened
 * over these ticks" and has to be emitted by the tick itself, because a part
 * that finished during a tick held a machine for all of it and is gone from
 * `wipParts` by the time anything can look.
 *
 * Unlike the frontend original this guards the step lookup. A part whose
 * `stepIndex` ran past the end of a shortened route is on no machine — the
 * same rule the tick applies when it finishes such a part — where the
 * frontend indexed `steps[stepIndex]` unguarded and crashed.
 */
export function deriveFloorView(
  wipParts: WipPart[],
  routingByWorkOrder: Map<number, Routing>,
  workCenters: Map<number, WorkCenter>,
): WorkCenterFloorView[] {
  /** work center id -> parts whose current step is here */
  const atStation = new Map<number, number>();
  /** work center id -> percent complete of each part actually on a machine */
  const progress = new Map<number, number[]>();

  for (const part of wipParts) {
    const routing = routingByWorkOrder.get(part.workOrderId);
    if (!routing) {
      throw new Error(
        `Part ${part.id} has no pinned routing for work order ${part.workOrderId}`,
      );
    }

    const step = routing.steps[part.stepIndex];
    // stranded past the end of a shortened route: holds no machine
    if (!step) continue;

    atStation.set(step.workCenterId, (atStation.get(step.workCenterId) ?? 0) + 1);

    if (part.progressSeconds > 0) {
      const running = progress.get(step.workCenterId) ?? [];
      running.push(
        Math.round((part.progressSeconds / part.actualProcessTimeSeconds) * 100),
      );
      progress.set(step.workCenterId, running);
    }
  }

  // every center, idle ones included, in the map's order — the same rule the
  // tick's metrics follow, so a card doesn't vanish when its center empties
  return [...workCenters.values()].map((workCenter) => {
    const running = (progress.get(workCenter.id) ?? []).sort((a, b) => b - a);
    return {
      workCenterId: workCenter.id,
      partsAtStation: atStation.get(workCenter.id) ?? 0,
      slots: Array.from(
        { length: workCenter.capacity },
        (_, slot) => running[slot] ?? null,
      ),
      slotsInUse: running.length,
    };
  });
}
