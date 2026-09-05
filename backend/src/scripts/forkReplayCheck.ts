/**
 * Replay-identity check for `forkRun` — the verification the seeded RNG and
 * the uuid-free draw key exist to make possible. Not part of `npm test` (the
 * vitest suite is pure functions only): this drives the HTTP API against a
 * running dev server, because what it proves is the *copy*, which is all DB.
 *
 *   npm run check:fork          # requires `npm run dev` in another terminal
 *
 * The claim under test: a fork advanced with no divergent decision is the
 * same run as its parent — byte-identical tick series over the shared and the
 * post-fork ticks, equal P&L — and a capital action applied to one branch
 * only makes their nets honestly diverge. Any missed column, reordered WIP
 * copy or torn state shows up as a diverging series, which is why this is
 * stronger than any mock-based unit test of the copy could be.
 *
 * Leaves its two runs behind on failure (named fork-check-*) so the floor and
 * charts can be inspected; deletes them on success.
 */
import assert from "node:assert/strict";

const BASE = process.env.API_BASE ?? "http://localhost:3000";
const SEED = 424242;
const MAX_TICKS_PER_REQUEST = 20_000;

type Run = {
  id: number;
  name: string;
  tickNum: number;
  dayTicks: number;
  parentRunId: number | null;
  forkedAtTick: number | null;
};

type RunSummary = Run & {
  wipCount: number;
  finishedCount: number;
  throughputCents: number;
  operatingExpenseCents: number;
  carryingCostCents: number;
  wageCents: number;
  capitalSpendCents: number;
  netCents: number;
};

async function api<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const init: RequestInit =
    body === undefined
      ? { method }
      : {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        };
  const response = await fetch(`${BASE}${path}`, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${method} ${path} -> ${response.status}: ${text}`);
  }
  return (await response.json()) as T;
}

const get = <T>(path: string) => api<T>("GET", path);
const post = <T>(path: string, body?: unknown) => api<T>("POST", path, body);

async function advanceBy(runId: number, ticks: number): Promise<void> {
  let left = ticks;
  while (left > 0) {
    const step = Math.min(left, MAX_TICKS_PER_REQUEST);
    await post(`/api/runs/${runId}/advance`, { ticks: step });
    left -= step;
  }
}

/** the run's money and state, without its identity columns */
function comparable(summary: RunSummary) {
  const {
    id: _id,
    name: _name,
    parentRunId: _parent,
    forkedAtTick: _forked,
    ...rest
  } = summary;
  return rest;
}

async function main() {
  const started = Date.now();

  const parent = await post<Run>("/api/runs", {
    name: "fork-check-parent",
    rngSeed: SEED,
  });
  console.log(`created run #${parent.id} (seed ${SEED})`);

  const workOrders = await get<{ id: number }[]>("/api/work-orders");
  assert.ok(workOrders.length > 0, "no work orders to release — run npm run seed");
  for (const order of workOrders) {
    await post(`/api/runs/${parent.id}/releases`, { workOrderId: order.id });
  }
  console.log(`released ${workOrders.length} work orders`);

  const halfDay = Math.floor(parent.dayTicks / 2);
  await advanceBy(parent.id, halfDay);
  const forkTick = halfDay;

  const forkStarted = Date.now();
  const child = await post<Run>(`/api/runs/${parent.id}/fork`, {
    name: "fork-check-child",
  });
  console.log(
    `forked at tick ${forkTick} in ${Date.now() - forkStarted}ms -> run #${child.id}`,
  );
  assert.equal(child.parentRunId, parent.id);
  assert.equal(child.forkedAtTick, forkTick);
  assert.equal(child.tickNum, forkTick);

  // the copied history must read identically before either branch moves
  const preTicksParent = await get<unknown>(
    `/api/runs/${parent.id}/ticks?fromTick=1&toTick=${forkTick}`,
  );
  const preTicksChild = await get<unknown>(
    `/api/runs/${child.id}/ticks?fromTick=1&toTick=${forkTick}`,
  );
  assert.deepEqual(preTicksChild, preTicksParent, "copied tick series differs");

  const preMetricsParent = await get<unknown>(
    `/api/runs/${parent.id}/metrics?fromTick=1&toTick=${forkTick}`,
  );
  const preMetricsChild = await get<unknown>(
    `/api/runs/${child.id}/metrics?fromTick=1&toTick=${forkTick}`,
  );
  assert.deepEqual(
    preMetricsChild,
    preMetricsParent,
    "metrics over the shared history differ",
  );
  console.log("copied history reads identically");

  // no divergent decision: the branches must stay the same run
  const shared = parent.dayTicks;
  await advanceBy(parent.id, shared);
  await advanceBy(child.id, shared);

  const postTicksParent = await get<unknown>(
    `/api/runs/${parent.id}/ticks?fromTick=${forkTick + 1}`,
  );
  const postTicksChild = await get<unknown>(
    `/api/runs/${child.id}/ticks?fromTick=${forkTick + 1}`,
  );
  assert.deepEqual(
    postTicksChild,
    postTicksParent,
    "branches diverged with no divergent decision",
  );

  const summaryParent = await get<RunSummary>(`/api/runs/${parent.id}`);
  const summaryChild = await get<RunSummary>(`/api/runs/${child.id}`);
  assert.deepEqual(
    comparable(summaryChild),
    comparable(summaryParent),
    "summaries diverged with no divergent decision",
  );
  console.log(
    `branches identical through tick ${summaryParent.tickNum} ` +
      `(net ${summaryParent.netCents}c, wip ${summaryParent.wipCount}, ` +
      `finished ${summaryParent.finishedCount})`,
  );

  // the ledger's target scenario: buy a machine in one branch only
  const floor = await get<{ workCenters: { workCenterId: number }[] }>(
    `/api/runs/${child.id}/floor`,
  );
  const centerId = floor.workCenters[0]?.workCenterId;
  assert.ok(centerId !== undefined, "child has no work centers");
  await post(`/api/runs/${child.id}/actions`, {
    kind: "buy_machine",
    workCenterId: centerId,
  });

  await advanceBy(parent.id, halfDay);
  await advanceBy(child.id, halfDay);
  const divergedParent = await get<RunSummary>(`/api/runs/${parent.id}`);
  const divergedChild = await get<RunSummary>(`/api/runs/${child.id}`);
  assert.notEqual(
    divergedChild.netCents,
    divergedParent.netCents,
    "buying a machine in one branch left the nets equal",
  );
  assert.notEqual(divergedChild.capitalSpendCents, 0);
  assert.equal(divergedParent.capitalSpendCents, 0);
  console.log(
    `after buy_machine in the child only: parent net ${divergedParent.netCents}c, ` +
      `child net ${divergedChild.netCents}c`,
  );

  // success: clean up (child first — the parent 409s while it has a fork)
  await api("DELETE", `/api/runs/${child.id}`);
  await api("DELETE", `/api/runs/${parent.id}`);
  console.log(`fork replay check passed in ${Math.round((Date.now() - started) / 1000)}s`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
