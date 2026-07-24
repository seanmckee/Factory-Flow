import type { WorkCenter } from "../types/WorkCenter.ts";

export const initialWorkCenters: WorkCenter[] = [
  {
    id: 1,
    name: "Raw Material",
    partsAtStation: 100,
    status: "Idle",
    processTimeSeconds: 1,
    progressSeconds: 0,
  },
  {
    id: 2,
    name: "Cutter",
    partsAtStation: 0,
    status: "Idle",
    processTimeSeconds: 3,
    progressSeconds: 0,
  },
  {
    id: 3,
    name: "Drill Press",
    partsAtStation: 0,
    status: "Idle",
    processTimeSeconds: 2,
    progressSeconds: 0,
  },
  {
    id: 4,
    name: "Deburr",
    partsAtStation: 0,
    status: "Idle",
    processTimeSeconds: 4,
    progressSeconds: 0,
  },
  {
    id: 5,
    name: "Inspection",
    partsAtStation: 0,
    status: "Idle",
    processTimeSeconds: 2,
    progressSeconds: 0,
  },
  {
    id: 6,
    name: "Packaging",
    partsAtStation: 0,
    status: "Idle",
    processTimeSeconds: 3,
    progressSeconds: 0,
  },
];
