export type Routing = {
  partId: number;
  steps: RoutingStep[];
};

type RoutingStep = {
  workCenterId: number;
  sequence: number;
  processTimeSeconds: number;
};
