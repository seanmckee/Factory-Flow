import type { Routing } from "../types/Routing";
import type { WipPart } from "../types/WipPart";
import { sampleProcessTime } from "./sampleProcessTime";
type SimulationTickResult = {
  wipParts: WipPart[];
  finishedParts: number;
};
export function simulateTick(
  wipParts: WipPart[],
  routings: Map<number, Routing>,
): SimulationTickResult {
  const newWipParts = wipParts.map((w) => ({ ...w }));
  let finishedParts = 0;
  const inServiceIds = new Set<string>();
  const claimed = new Set<number>();

  for (const wp of newWipParts) {
    const partRouting = routings.get(wp.routingId);
    if (!partRouting) {
      console.error("No routing found for part", wp.id, wp.routingId);
      continue;
    }
    const wcId = partRouting.steps[wp.stepIndex].workCenterId;
    if (wp.progressSeconds > 0) {
      inServiceIds.add(wp.id);
      claimed.add(wcId);
    }
  }

  for (const wp of newWipParts) {
    const partRouting = routings.get(wp.routingId);
    if (!partRouting) {
      console.error("No routing found for part", wp.id, wp.routingId);
      continue;
    }
    const wcId = partRouting.steps[wp.stepIndex].workCenterId;
    if (!claimed.has(wcId)) {
      inServiceIds.add(wp.id);
      claimed.add(wcId);
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
        finishedParts += 1;
        wipPart.stepIndex = -1;
      }
    }
  }
  return {
    wipParts: newWipParts.filter((w) => w.stepIndex !== -1),
    finishedParts,
  };
}
