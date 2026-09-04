export type RoutingStep = {
  id: number;
  routingId: number;
  workCenterId: number;
  sequence: number;
  processTimeSeconds: number;
  setupTimeSeconds: number;
  /** chance a unit is ruined on completing this step, in basis points */
  scrapBps: number;
};

export type Routing = {
  id: number;
  partId: number;
  name: string;
  revision: string;
  steps: RoutingStep[];
};

/**
 * GET /api/routings returns routings without their steps; GET /:id includes
 * them. The summary carries stepCount instead, because a routing with no steps
 * can't be produced and the list needs to say so.
 */
export type RoutingSummary = Omit<Routing, "steps"> & { stepCount: number };
