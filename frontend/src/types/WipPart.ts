export type WipPart = {
  id: number;
  workOrderId: number;
  stepIndex: number;
  progressSeconds: number;
  actualProcessTimeSeconds: number;
};
