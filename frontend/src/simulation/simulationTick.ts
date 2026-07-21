import type { Routing } from "../types/Routing";
import type { WipPart } from "../types/WipPart";
import type { WorkCenter, WorkCenterStatus } from "../types/WorkCenter";
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
  for (const wipPart of newWipParts) {
    const step = routing.steps[wipPart.stepIndex];
    wipPart.progressSeconds += 1;

    if (wipPart.progressSeconds >= step.processTimeSeconds) {
      wipPart.progressSeconds = 0;
      if (wipPart.stepIndex + 1 < routing.steps.length) {
        wipPart.stepIndex += 1;
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
function calculateStatus(workCenter: WorkCenter): WorkCenterStatus {
  let status: WorkCenterStatus;
  if (workCenter.queueCount > 0) {
    status = "Running";
  } else {
    status = "Starved";
  }
  return status;
}
