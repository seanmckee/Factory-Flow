export type WorkCenter = {
  id: number;
  name: string;
  queueCount: number;
  status: "Idle" | "Busy" | "Blocked";
  processTimeSeconds: number;
  progressSeconds: number;
};
