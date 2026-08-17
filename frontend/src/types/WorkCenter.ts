export type WorkCenter = {
  id: number;
  name: string;
  capacity: number;
};

export type WorkCenterView = {
  // parts whose current routing step is this work center (running + waiting)
  partsAtStation: number;
  // one entry per machine: percent complete, or null when that machine is idle
  slots: (number | null)[];
  slotsInUse: number;
  utilization: number;
};
