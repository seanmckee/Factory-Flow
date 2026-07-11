export type WorkCenter = {
  id: number;
  name: string;
  queueCount: number;
  status: WorkCenterStatus;
  processTimeSeconds: number;
  progressSeconds: number;
};

export type WorkCenterStatus = "Idle" | "Running" | "Blocked" | "Starved";

export type DbWorkCenter = {
  id: number;
  name: string;
};
