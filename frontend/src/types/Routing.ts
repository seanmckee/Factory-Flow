export type RoutingStep = {
  id: number;
  routingId: number;
  workCenterId: number;
  sequence: number;
  processTimeSeconds: number;
  setupTimeSeconds: number;
};

export type Routing = {
  id: number;
  partId: number;
  name: string;
  revision: string;
  steps: RoutingStep[];
};
