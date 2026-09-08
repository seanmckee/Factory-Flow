import { describe, expect, it } from "vitest";
import { parseComparison } from "./verdict";

/** the comparator's payload, trimmed to the fields the guard reads */
const verdict = {
  baseline: { runId: 58, name: "Baseline · CONWIP 150", tickNum: 230400, netCents: 1094433 },
  variant: { runId: 59, name: "Second drill press", tickNum: 230400, netCents: 1543208 },
  window: {
    fromTick: 86341,
    toTick: 230400,
    dayTicks: 28800,
    basis: "since the fork at Day 4 · 0:00:00",
    forkedAtTick: 86400,
  },
  winnerRunId: 59,
  netDeltaCents: 448775,
  pl: [
    {
      line: "throughputCents",
      label: "Throughput",
      baselineCents: 2983900,
      variantCents: 3792300,
      deltaCents: 808400,
      netEffectCents: 808400,
    },
  ],
  biggestMover: null,
  outcomes: {},
  summary: "#59 Second drill press wins by $4,487.75 of net profit over #58 Baseline · CONWIP 150.",
};

describe("parseComparison", () => {
  it("narrows a verdict the service sent", () => {
    const parsed = parseComparison(verdict);
    expect(parsed?.netDeltaCents).toBe(448775);
    expect(parsed?.winnerRunId).toBe(59);
    expect(parsed?.window.basis).toBe("since the fork at Day 4 · 0:00:00");
  });

  it("keeps a dead heat, which is an answer rather than a gap", () => {
    const parsed = parseComparison({ ...verdict, winnerRunId: null, netDeltaCents: 0 });
    expect(parsed?.winnerRunId).toBeNull();
    expect(parsed?.netDeltaCents).toBe(0);
  });

  it("rejects a payload missing the fields the transcript draws", () => {
    // version skew after a deploy: draw nothing and leave the reply standing,
    // rather than render half a verdict
    expect(parseComparison({ ...verdict, summary: undefined })).toBeNull();
    expect(parseComparison({ ...verdict, netDeltaCents: "448775" })).toBeNull();
    expect(parseComparison({ ...verdict, pl: undefined })).toBeNull();
    expect(parseComparison({ ...verdict, baseline: undefined })).toBeNull();
  });

  it("rejects anything that is not an object", () => {
    expect(parseComparison(null)).toBeNull();
    expect(parseComparison("Tool call failed: backend 404")).toBeNull();
    expect(parseComparison(42)).toBeNull();
  });
});
