export type WorkCenter = {
  id: number;
  name: string;
  partsAtStation: number;
  status: WorkCenterStatus;
};

export type WorkCenterStatus = "Idle" | "Running" | "Blocked" | "Starved";

export type DbWorkCenter = {
  id: number;
  name: string;
};

export type WorkCenterView = {
  partsAtStation: number;
  percentFinished: number;
};
