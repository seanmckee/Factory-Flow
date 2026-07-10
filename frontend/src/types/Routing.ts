export type Routing = {
  id: number;
  partId: number;
  steps: RoutingStep[];
};

type RoutingStep = {
  workCenterId: number;
  sequence: number;
  processTimeSeconds: number;
};
