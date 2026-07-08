import type { WorkCenter, WorkCenterStatus } from "../types/WorkCenter";

export function simulateTick(
  workCenters: WorkCenter[],
  productionLine: number[],
): WorkCenter[] {
  console.log("simulating tick");

  const newWorkCenters = workCenters.map((workCenter) => ({
    ...workCenter,
  }));

  for (const workCenter of newWorkCenters) {
    if (workCenter.queueCount <= 0) {
      workCenter.progressSeconds = 0;

      continue;
    }

    workCenter.progressSeconds += 1;

    if (workCenter.progressSeconds >= workCenter.processTimeSeconds) {
      const currentProductionStep = productionLine.indexOf(workCenter.id);

      if (currentProductionStep + 1 < productionLine.length) {
        const nextWorkCenterId = productionLine[currentProductionStep + 1];

        const nextWorkCenter = newWorkCenters.find(
          (wc) => wc.id === nextWorkCenterId,
        );

        if (nextWorkCenter) {
          nextWorkCenter.queueCount += 1;
        }
      }

      workCenter.queueCount -= 1;
      workCenter.progressSeconds = 0;
    }
  }
  const updatedWorkCenters = newWorkCenters.map((workCenter) => ({
    ...workCenter,
    status: calculateStatus(workCenter),
  }));
  return updatedWorkCenters;
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
