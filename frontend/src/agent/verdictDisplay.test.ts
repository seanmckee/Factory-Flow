import { describe, expect, it } from "vitest";
import type { ComparisonLine, ComparisonOutcomes, RunComparison } from "./verdict";
import {
  barFraction,
  formatDeltaCents,
  formatDeltaCount,
  formatFraction,
  formatDurationDelta,
  formatFractionDelta,
  formatMoneyCents,
  netEffectScale,
  outcomeRows,
  winnerLabel,
} from "./verdictDisplay";

function line(netEffectCents: number, name = "throughputCents"): ComparisonLine {
  return {
    line: name,
    label: name,
    baselineCents: 0,
    variantCents: netEffectCents,
    deltaCents: netEffectCents,
    netEffectCents,
  };
}

describe("netEffectScale", () => {
  it("is the biggest move in either direction", () => {
    // Not the net delta: the lines offset each other — a purchase that pays
    // back is throughput up and capital down — so scaling against the net
    // would draw the two largest forces wider than the track.
    expect(netEffectScale([line(808_400), line(-148_800, "capitalSpendCents")])).toBe(
      808_400,
    );
    expect(netEffectScale([line(1_000), line(-9_000, "wageCents")])).toBe(9_000);
  });

  it("is zero when nothing moved", () => {
    expect(netEffectScale([line(0), line(0, "wageCents")])).toBe(0);
    expect(netEffectScale([])).toBe(0);
  });
});

describe("barFraction", () => {
  it("scales against the widest mover, ignoring direction", () => {
    expect(barFraction(-500, 1_000)).toBe(0.5);
    expect(barFraction(1_000, 1_000)).toBe(1);
  });

  it("draws nothing rather than dividing by a zero scale", () => {
    expect(barFraction(0, 0)).toBe(0);
    expect(barFraction(500, 0)).toBe(0);
  });
});

describe("formatMoneyCents", () => {
  it("groups thousands, so the table agrees with the sentence beside it", () => {
    expect(formatMoneyCents(2_983_900)).toBe("$29,839.00");
    expect(formatMoneyCents(448_775)).toBe("$4,487.75");
    expect(formatMoneyCents(5)).toBe("$0.05");
  });

  it("puts the minus before the dollar sign, not after it", () => {
    expect(formatMoneyCents(-148_800)).toBe("−$1,488.00");
  });
});

describe("money and count deltas", () => {
  it("carries the sign, because the sign is the content", () => {
    expect(formatDeltaCents(808_400)).toBe("+$8,084.00");
    expect(formatDeltaCents(-148_800)).toBe("−$1,488.00");
  });

  it("prints an unchanged line as money, not as a dash", () => {
    // The two runs genuinely agreed on that line — a finding, not a gap.
    expect(formatDeltaCents(0)).toBe("$0.00");
    expect(formatDeltaCount(0)).toBe("0");
  });

  it("dashes a count neither side measured", () => {
    expect(formatDeltaCount(null)).toBe("—");
    expect(formatDeltaCount(-41)).toBe("−41");
  });
});

describe("fractions", () => {
  it("reads a fraction as a percentage and an absence as a dash", () => {
    expect(formatFraction(0.95)).toBe("95%");
    expect(formatFraction(null)).toBe("—");
  });

  it("reads a difference in percentage POINTS, not percent", () => {
    // 90% to 95% is five points. Calling it "5%" is the standard way to
    // overstate it, and on-time delivery is exactly the figure that gets
    // quoted out of context.
    expect(formatFractionDelta(0.05)).toBe("+5.0 pts");
    expect(formatFractionDelta(-0.12)).toBe("−12.0 pts");
  });

  it("does not dress a rounding crumb up as a move", () => {
    expect(formatFractionDelta(0.0001)).toBe("0 pts");
    expect(formatFractionDelta(0)).toBe("0 pts");
  });

  it("dashes an unmeasured promise rather than calling it no change", () => {
    expect(formatFractionDelta(null)).toBe("—");
  });
});

const outcomes: ComparisonOutcomes = {
  finished: { baseline: 513, variant: 879, delta: 366 },
  onTimeFraction: {
    baseline: 1,
    variant: 1,
    delta: 0,
    baselineMeasured: 501,
    variantMeasured: 862,
  },
  meanCycleSeconds: { baseline: 45_600, variant: 34_380, delta: -11_220 },
  p95CycleSeconds: { baseline: 90_000, variant: 60_000, delta: -30_000 },
  meanWip: { baseline: 120.4, variant: 124.6, delta: 4.2 },
  maxWip: { baseline: 292, variant: 333, delta: 41 },
  scrappedCount: { baseline: 2, variant: 5, delta: 3 },
  constraint: {
    baseline: {
      workCenterId: 98,
      utilization: 0.976,
      busyMachineTicks: 140_616,
      capacityTicks: 144_060,
    },
    variant: {
      workCenterId: 95,
      utilization: 1,
      busyMachineTicks: 144_060,
      capacityTicks: 144_060,
    },
  },
};

describe("formatDurationDelta", () => {
  it("reads an improvement at duration resolution, not in raw seconds", () => {
    // formatDurationSeconds assumes a duration, so its two-minute threshold
    // catches every negative: -11,238 came out as "−11238s" where the answer
    // is "−3.1h". Caught in a browser pass, not by a unit test.
    expect(formatDurationDelta(-11_220)).toBe("−3.1h");
    expect(formatDurationDelta(11_220)).toBe("+3.1h");
  });

  it("keeps small differences small", () => {
    expect(formatDurationDelta(-45)).toBe("−45s");
    expect(formatDurationDelta(0)).toBe("0s");
  });

  it("dashes a difference neither side measured", () => {
    expect(formatDurationDelta(null)).toBe("—");
  });
});

describe("outcomeRows", () => {
  it("knows which rows improve by falling", () => {
    // A table that coloured every increase as good would recommend the wrong
    // decision: cycle time, WIP and scrap all improve by going down.
    const rows = outcomeRows(outcomes);
    const better = Object.fromEntries(
      rows.map((row) => [row.label, row.higherIsBetter]),
    );
    expect(better["Finished units"]).toBe(true);
    expect(better["On-time delivery"]).toBe(true);
    expect(better["Mean cycle time"]).toBe(false);
    expect(better["Mean / peak WIP"]).toBe(false);
    expect(better["Scrapped units"]).toBe(false);
  });

  it("formats counts as counts and means as means", () => {
    const rows = outcomeRows(outcomes);
    const finished = rows.find((row) => row.label === "Finished units");
    expect(finished?.baseline).toBe("513");
    expect(finished?.delta).toBe("+366");

    const wip = rows.find((row) => row.label === "Mean / peak WIP");
    expect(wip?.baseline).toBe("120.4 / 292");
    expect(wip?.delta).toBe("+41 peak");
  });

  it("reads cycle time at reading resolution", () => {
    const rows = outcomeRows(outcomes);
    const cycle = rows.find((row) => row.label === "Mean cycle time");
    expect(cycle?.baseline).toBe("12.7h");
    expect(cycle?.variant).toBe("9.6h");
  });

  it("dashes a side that measured nothing instead of reading it as zero", () => {
    const rows = outcomeRows({
      ...outcomes,
      onTimeFraction: {
        baseline: null,
        variant: 0.9,
        delta: null,
        baselineMeasured: 0,
        variantMeasured: 40,
      },
    });
    const otd = rows.find((row) => row.label === "On-time delivery");
    expect(otd?.baseline).toBe("—");
    expect(otd?.variant).toBe("90%");
    expect(otd?.delta).toBe("—");
  });
});

describe("winnerLabel", () => {
  const verdict = {
    baseline: { runId: 58, name: "Baseline · CONWIP 150", tickNum: 1, netCents: 1 },
    variant: { runId: 59, name: "Second drill press", tickNum: 1, netCents: 2 },
  } as RunComparison;

  it("names whichever side won", () => {
    expect(winnerLabel({ ...verdict, winnerRunId: 59 })).toBe("#59 Second drill press");
    expect(winnerLabel({ ...verdict, winnerRunId: 58 })).toBe(
      "#58 Baseline · CONWIP 150",
    );
  });

  it("has no winner on a dead heat", () => {
    // Which is what two same-seed branches with no decision between them must
    // report — inventing a winner there would be reporting the dice.
    expect(winnerLabel({ ...verdict, winnerRunId: null })).toBeNull();
  });
});
