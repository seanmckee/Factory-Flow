import type { Routing } from "../types/Routing";

export const routings: Routing[] = [
  {
    id: 1,
    partId: 1,
    steps: [
      {
        workCenterId: 1,
        sequence: 1,
        processTimeSeconds: 1,
      },
      {
        workCenterId: 2,
        sequence: 2,
        processTimeSeconds: 3,
      },
      {
        workCenterId: 3,
        sequence: 3,
        processTimeSeconds: 2,
      },
      {
        workCenterId: 4,
        sequence: 4,
        processTimeSeconds: 4,
      },
      {
        workCenterId: 5,
        sequence: 5,
        processTimeSeconds: 2,
      },
      {
        workCenterId: 6,
        sequence: 6,
        processTimeSeconds: 3,
      },
    ],
  },
];
