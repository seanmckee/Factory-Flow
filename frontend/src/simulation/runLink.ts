/**
 * A run (and optionally a run to compare it against) as URL state.
 *
 * Compare state used to live only in `useSimulationPage`, which made a
 * comparison unshareable: the one thing worth sending someone — these two
 * branches, on one clock, with the fork seam between them — could only be
 * reproduced by describing which selections to make. Putting the pair in the
 * query string is what lets the agent's verdict card link straight at the
 * comparison it just judged, and what lets a person paste it to somebody.
 *
 * Pure, and the single place that knows the parameter names, so a link built
 * here and a link parsed here cannot drift apart.
 */

export const RUN_PARAM = "run";
export const COMPARE_PARAM = "compare";

/**
 * The query the simulator page reads back, for one run or a compared pair.
 * Shared with `runLink` so a link and the URL a selection writes are built by
 * the same code — the point of this module.
 */
export function runLinkParams(
  runId: number,
  compareRunId?: number | null,
): URLSearchParams {
  const params = new URLSearchParams({ [RUN_PARAM]: String(runId) });
  if (compareRunId != null && compareRunId !== runId) {
    params.set(COMPARE_PARAM, String(compareRunId));
  }
  return params;
}

/** The simulator page addressing one run, or a comparison of two. */
export function runLink(runId: number, compareRunId?: number | null): string {
  return `/?${runLinkParams(runId, compareRunId).toString()}`;
}

export type RunLink = {
  /** null when the URL named no run, or named one that isn't there any more */
  runId: number | null;
  compareRunId: number | null;
  /** ids the URL named that the run list doesn't have — a shared link outliving
   * a deleted run, which is worth saying out loud rather than silently ignoring */
  missing: number[];
};

function readId(raw: string | null): number | null {
  if (raw === null) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Resolves the pair against the runs that actually exist.
 *
 * Validation is against the list rather than left to a 404 on purpose: a run
 * can be deleted after a link is shared, and the honest answer is to fall
 * back and say so, not to open a page that reports a failed fetch. A run
 * compared with itself is dropped for the same reason the comparator refuses
 * it — there is no comparison there.
 */
export function parseRunLink(
  params: URLSearchParams,
  runs: readonly { id: number }[],
): RunLink {
  const ids = new Set(runs.map((run) => run.id));
  const requestedRun = readId(params.get(RUN_PARAM));
  const requestedCompare = readId(params.get(COMPARE_PARAM));
  const missing: number[] = [];

  const runId = requestedRun !== null && ids.has(requestedRun) ? requestedRun : null;
  if (requestedRun !== null && runId === null) missing.push(requestedRun);

  let compareRunId: number | null = null;
  if (requestedCompare !== null) {
    if (!ids.has(requestedCompare)) missing.push(requestedCompare);
    else if (requestedCompare !== runId) compareRunId = requestedCompare;
  }
  // a comparison needs the run it compares against; on its own it means nothing
  if (runId === null) compareRunId = null;

  return { runId, compareRunId, missing };
}
