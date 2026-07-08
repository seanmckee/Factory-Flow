import type { WorkCenter } from "../types/WorkCenter.ts";

export const initialWorkCenters: WorkCenter[] = [
  {
    id: 1,
    name: "Raw Material",
    queueCount: 100,
    status: "Idle",
    processTimeSeconds: 1,
    progressSeconds: 0,
  },
  {
    id: 2,
    name: "Cutter",
    queueCount: 0,
    status: "Idle",
    processTimeSeconds: 3,
    progressSeconds: 0,
  },
  {
    id: 3,
    name: "Drill Press",
    queueCount: 0,
    status: "Idle",
    processTimeSeconds: 2,
    progressSeconds: 0,
  },
  {
    id: 4,
    name: "Deburr",
    queueCount: 0,
    status: "Idle",
    processTimeSeconds: 4,
    progressSeconds: 0,
  },
  {
    id: 5,
    name: "Inspection",
    queueCount: 0,
    status: "Idle",
    processTimeSeconds: 2,
    progressSeconds: 0,
  },
  {
    id: 6,
    name: "Packaging",
    queueCount: 0,
    status: "Idle",
    processTimeSeconds: 1,
    progressSeconds: 0,
  },
];
