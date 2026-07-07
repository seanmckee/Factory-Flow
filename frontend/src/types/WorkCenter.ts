export type WorkCenter = {
  name: string;
  queueCount: number;
  status: "Idle" | "Busy" | "Blocked";
};
