export type WipPart = {
  id: string;
  workOrderId: number;
  routingId: number;
  stepIndex: number;
  progressSeconds: number;
  actualProcessTimeSeconds: number;
};
