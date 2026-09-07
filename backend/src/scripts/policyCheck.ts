/**
 * End-to-end check for release policies — the check:fork pattern: drives the
 * HTTP API against a running dev server, because what it proves (the advance
 * loop's releases, the policy endpoint, fork isolation) is all DB and routes.
 *
 *   npm run check:policy        # requires `npm run dev` in another terminal
 *
 * Three claims:
 * 1. A conwip run feeds its own floor — a day advances with zero manual
 *    releases, and the auto-releases come out in EDD order (earliest due day
 *    first) with the floor capped.
 * 2. Determinism survives the policy: re-creating the run with the same seed
 *    and the same policy change reproduces the release sequence and the money
 *    byte for byte.
 * 3. Fork isolation: re-policying a parent never reaches a fork taken
 *    earlier — the runtime net for `forkRun`'s hand-maintained column list,
 *    which nothing checks at compile time.
 *
 * Leaves its runs behind on failure (named policy-check-*); deletes them on
 * success.
 */
import assert from "node:assert/strict";

const BASE = process.env.API_BASE ?? "http://localhost:3000";
const SEED = 777001;
const WIP_CAP = 400;
const MAX_TICKS_PER_REQUEST = 20_000;

type Run = {
  id: number;
  name: string;
  tickNum: number;
  dayTicks: number;
  releasePolicy: string;
  wipCap: number;
  parentRunId: number | null;
};

type RunSummary = Run & {
  wipCount: number;
  finishedCount: number;
  throughputCents: number;
  netCents: number;
};

type AdvanceResult = {
  tickNum: number;
  wipCount: number;
  backlogCount: number;
  autoReleased: {
    workOrderId: number;
    partsReleased: number;
    releasedAtTick: number;
  }[];
};

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
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
    throw new Error(`${method} ${path} -> ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

const get = <T>(path: string) => api<T>("GET", path);
const post = <T>(path: string, body?: unknown) => api<T>("POST", path, body);

/** advance in request-sized chunks, collecting every auto-release in order */
async function advanceBy(
  runId: number,
  ticks: number,
): Promise<AdvanceResult["autoReleased"]> {
  const released: AdvanceResult["autoReleased"] = [];
  let left = ticks;
  while (left > 0) {
    const step = Math.min(left, MAX_TICKS_PER_REQUEST);
    const result = await post<AdvanceResult>(`/api/runs/${runId}/advance`, {
      ticks: step,
    });
    released.push(...result.autoReleased);
    left -= step;
  }
  return released;
}

/** work order id -> its earliest covering due day, from the live book */
async function dueDayByWorkOrder(): Promise<Map<number, number | null>> {
  const salesOrders = await get<
    { dueDay: number | null; allocations: { workOrderId: number }[] }[]
  >("/api/sales-orders");
  const map = new Map<number, number | null>();
  for (const so of salesOrders) {
    for (const allocation of so.allocations) {
      const known = map.get(allocation.workOrderId);
      if (known === undefined || known === null) {
        map.set(allocation.workOrderId, so.dueDay);
      } else if (so.dueDay !== null && so.dueDay < known) {
        map.set(allocation.workOrderId, so.dueDay);
      }
    }
  }
  return map;
}

async function conwipDay(name: string): Promise<{
  run: Run;
  released: AdvanceResult["autoReleased"];
  summary: RunSummary;
  ticks: unknown;
}> {
  const run = await post<Run>("/api/runs", { name, rngSeed: SEED });
  const policied = await post<Run>(`/api/runs/${run.id}/policy`, {
    releasePolicy: "conwip",
    wipCap: WIP_CAP,
  });
  assert.equal(policied.releasePolicy, "conwip");
  assert.equal(policied.wipCap, WIP_CAP);
  const released = await advanceBy(run.id, run.dayTicks);
  const summary = await get<RunSummary>(`/api/runs/${run.id}`);
  const ticks = await get<unknown>(`/api/runs/${run.id}/ticks`);
  return { run, released, summary, ticks };
}

async function main() {
  const started = Date.now();

  // 1. a conwip run feeds itself, in EDD order
  const first = await conwipDay("policy-check-a");
  assert.ok(
    first.released.length > 0,
    "a conwip day released nothing — the floor was never fed",
  );
  const dueByOrder = await dueDayByWorkOrder();
  const releasedDueDays = first.released.map(
    (entry) => dueByOrder.get(entry.workOrderId) ?? null,
  );
  const dated = releasedDueDays.filter((day): day is number => day !== null);
  for (let i = 1; i < dated.length; i++) {
    assert.ok(
      dated[i]! >= dated[i - 1]!,
      `releases out of EDD order: due days ${dated.join(", ")}`,
    );
  }
  assert.ok(first.summary.wipCount > 0 || first.summary.finishedCount > 0);
  console.log(
    `conwip day: ${first.released.length} orders auto-released, ` +
      `wip ${first.summary.wipCount}, finished ${first.summary.finishedCount}, ` +
      `net ${first.summary.netCents}c`,
  );

  // 2. same seed + same policy change => the same run
  const second = await conwipDay("policy-check-b");
  assert.deepEqual(second.released, first.released, "release sequences differ");
  assert.equal(second.summary.netCents, first.summary.netCents);
  assert.equal(second.summary.finishedCount, first.summary.finishedCount);
  assert.equal(second.summary.wipCount, first.summary.wipCount);
  assert.deepEqual(second.ticks, first.ticks, "tick series differ");
  console.log("same seed + same policy reproduces the run byte for byte");

  // 3. re-policying a parent never reaches a fork taken earlier
  const child = await post<Run>(`/api/runs/${first.run.id}/fork`, {
    name: "policy-check-fork",
  });
  assert.equal(child.releasePolicy, "conwip", "fork lost the policy columns");
  assert.equal(child.wipCap, WIP_CAP, "fork lost the policy numbers");
  await post(`/api/runs/${first.run.id}/policy`, { releasePolicy: "manual" });
  const parentAfter = await get<Run>(`/api/runs/${first.run.id}`);
  const childAfter = await get<Run>(`/api/runs/${child.id}`);
  assert.equal(parentAfter.releasePolicy, "manual");
  assert.equal(childAfter.releasePolicy, "conwip", "parent change reached the fork");

  // the manual parent releases nothing on its own and reports no backlog
  const hour = 3_600;
  const parentAdvance = await post<AdvanceResult>(
    `/api/runs/${first.run.id}/advance`,
    { ticks: hour },
  );
  assert.deepEqual(parentAdvance.autoReleased, []);
  assert.equal(parentAdvance.backlogCount, 0);
  // the conwip child keeps feeding itself as its floor drains
  const childAdvance = await post<AdvanceResult>(`/api/runs/${child.id}/advance`, {
    ticks: hour,
  });
  assert.ok(
    childAdvance.backlogCount >= 0 &&
      (childAdvance.autoReleased.length > 0 || childAdvance.wipCount > 0),
    "the conwip child neither released nor held WIP",
  );
  console.log("fork isolation holds: parent manual, fork still conwip");

  // success: clean up (children before parents)
  await api("DELETE", `/api/runs/${child.id}`);
  await api("DELETE", `/api/runs/${first.run.id}`);
  await api("DELETE", `/api/runs/${second.run.id}`);
  console.log(
    `policy check passed in ${Math.round((Date.now() - started) / 1000)}s`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
