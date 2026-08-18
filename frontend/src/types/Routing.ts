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

/** GET /api/routings returns routings without their steps; GET /:id includes them. */
export type RoutingSummary = Omit<Routing, "steps">;
