import type { Routing } from "../types/Routing";
import type { WipPart } from "../types/WipPart";
import type { WorkCenter } from "../types/WorkCenter";
import { sampleProcessTime } from "./sampleProcessTime";
type SimulationTickResult = {
  wipParts: WipPart[];
  finishedParts: WipPart[];

};

export function simulateTick(
  wipParts: WipPart[],
  routings: Map<number, Routing>,
  tickNum: number,
  workCenters: Map<number, WorkCenter>,
): SimulationTickResult {
  const newWipParts = wipParts.map((w) => ({ ...w }));
  const finishedParts: WipPart[] = [];
  const inServiceIds = new Set<string>();
  // workCenterId -> machines currently occupied
  const inUse = new Map<number, number>();

  // parts already mid-process keep the machine they started on
  for (const wp of newWipParts) {
    const partRouting = routings.get(wp.routingId);
    if (!partRouting) {
      console.error("No routing found for part", wp.id, wp.routingId);
      continue;
    }
    const wcId = partRouting.steps[wp.stepIndex].workCenterId;
    const workCenter = workCenters.get(wcId);
    if (!workCenter) {
      console.error("No work center found for part", wp.id, wcId);
      continue;
    }
    if (wp.progressSeconds > 0) {
      inServiceIds.add(wp.id);
      inUse.set(wcId, (inUse.get(wcId) ?? 0) + 1);
    }
  }

  // admit waiting parts onto whatever machines are still free
  for (const wp of newWipParts) {
    const partRouting = routings.get(wp.routingId);
    if (!partRouting) {
      console.error("No routing found for part", wp.id, wp.routingId);
      continue;
    }
    const wcId = partRouting.steps[wp.stepIndex].workCenterId;
    const workCenter = workCenters.get(wcId);
    if (!workCenter) {
      console.error("No work center found for part", wp.id, wcId);
      continue;
    }
    // already holding a machine from the pass above
    if (inServiceIds.has(wp.id)) continue;
    if ((inUse.get(wcId) ?? 0) < workCenter.capacity) {
      inServiceIds.add(wp.id);
      inUse.set(wcId, (inUse.get(wcId) ?? 0) + 1);
    }
  }
  for (const wipPart of newWipParts) {
    if (!inServiceIds.has(wipPart.id)) continue;

    const partRouting = routings.get(wipPart.routingId);

    if (!partRouting) {
      console.error("No routing found for part", wipPart.id, wipPart.routingId);
      continue;
    }
    wipPart.progressSeconds += 1;

    if (wipPart.progressSeconds >= wipPart.actualProcessTimeSeconds) {
      wipPart.progressSeconds = 0;
      if (wipPart.stepIndex + 1 < partRouting.steps.length) {
        wipPart.stepIndex += 1;
        wipPart.actualProcessTimeSeconds = sampleProcessTime(
          partRouting.steps[wipPart.stepIndex].processTimeSeconds,
          0.3,
        );
      } else {
        // deal with finished parts
        finishedParts.push({...wipPart, completedAtTick: tickNum});
        wipPart.stepIndex = -1;
      }
    }
  }
  return {
    wipParts: newWipParts.filter((w) => w.stepIndex !== -1),
    finishedParts,
  };
}
