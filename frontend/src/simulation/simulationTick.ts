import type { Routing } from "../types/Routing";
import type { WipPart } from "../types/WipPart";
import { sampleProcessTime } from "./sampleProcessTime";
type SimulationTickResult = {
  wipParts: WipPart[];
  finishedParts: number;
};
export function simulateTick(
  wipParts: WipPart[],
  routing: Routing,
): SimulationTickResult {
  const newWipParts = wipParts.map((w) => ({ ...w }));
  let finishedParts = 0;
  const inServiceIds = new Set<number>();
  const claimed = new Set<number>();

  for (const wp of newWipParts) {
    const wcId = routing.steps[wp.stepIndex].workCenterId;
    if (wp.progressSeconds > 0) {
      inServiceIds.add(wp.id);
      claimed.add(wcId);
    }
  }

  for (const wp of newWipParts) {
    const wcId = routing.steps[wp.stepIndex].workCenterId;
    if (!claimed.has(wcId)) {
      inServiceIds.add(wp.id);
      claimed.add(wcId);
    }
  }
  for (const wipPart of newWipParts) {
    if (!inServiceIds.has(wipPart.id)) continue;
    wipPart.progressSeconds += 1;

    if (wipPart.progressSeconds >= wipPart.actualProcessTimeSeconds) {
      wipPart.progressSeconds = 0;
      if (wipPart.stepIndex + 1 < routing.steps.length) {
        wipPart.stepIndex += 1;
        wipPart.actualProcessTimeSeconds = sampleProcessTime(
          routing.steps[wipPart.stepIndex].processTimeSeconds,
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
