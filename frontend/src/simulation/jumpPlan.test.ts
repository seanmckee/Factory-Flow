import { describe, expect, it } from "vitest";
import {
  DEFAULT_HORIZON_INDEX,
  JUMP_CONDITIONS,
  JUMP_HORIZONS,
  TICKS_PER_HOUR,
  alreadyMet,
  clampHorizon,
  conditionMet,
  describeStop,
  horizonLabel,
  horizonTicks,
  type JumpCondition,
  type JumpProbe,
} from "./jumpPlan";

const DAY = 28_800;

const probe = (overrides: Partial<JumpProbe> = {}): JumpProbe => ({
  tickNum: DAY * 2,
  wipCount: 120,
  backlogCount: 3,
  scrappedSoFar: 0,
  netCents: -45_000,
  ...overrides,
});

describe("the horizon scale", () => {
  it("rises without repeating a stop", () => {
    const ticks = JUMP_HORIZONS.map((_, index) => horizonTicks(index, DAY));
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
    expect(new Set(ticks).size).toBe(ticks.length);
  });

  it("measures hours in staffed hours and days in the run's own day", () => {
    expect(horizonTicks(0, DAY)).toBe(TICKS_PER_HOUR);
    // a two-shift run's day is twice the ticks, and the same calendar day
    expect(horizonTicks(DEFAULT_HORIZON_INDEX, DAY)).toBe(DAY);
    expect(horizonTicks(DEFAULT_HORIZON_INDEX, DAY * 2)).toBe(DAY * 2);
  });

  it("falls back to a one-shift day rather than a horizon of nothing", () => {
    // a run summary that has not loaded yet must not produce a zero-tick jump
    expect(horizonTicks(DEFAULT_HORIZON_INDEX, 0)).toBe(DAY);
  });

  it("defaults to one day, where the old presets topped out", () => {
    expect(horizonLabel(DEFAULT_HORIZON_INDEX)).toBe("1 day");
  });

  it("clamps a position off either end of the track", () => {
    expect(clampHorizon(-4)).toBe(0);
    expect(clampHorizon(999)).toBe(JUMP_HORIZONS.length - 1);
    expect(clampHorizon(2.4)).toBe(2);
  });
});

describe("conditions", () => {
  it("never fires without one, so the horizon is the only bound", () => {
    expect(conditionMet({ kind: "none" }, probe({ wipCount: 0, backlogCount: 0 }))).toBe(false);
  });

  it("reads a drained floor as empty *and* unfeedable", () => {
    const drained: JumpCondition = { kind: "floorDrained" };
    expect(conditionMet(drained, probe({ wipCount: 0, backlogCount: 0 }))).toBe(true);
    // the policy can still refill it, so the run is not finished
    expect(conditionMet(drained, probe({ wipCount: 0, backlogCount: 2 }))).toBe(false);
  });

  it("separates a cleared backlog from an empty floor", () => {
    expect(conditionMet({ kind: "backlogClear" }, probe({ wipCount: 90, backlogCount: 0 }))).toBe(true);
  });

  it("compares WIP strictly, so a threshold is a threshold", () => {
    expect(conditionMet({ kind: "wipAbove", value: 120 }, probe({ wipCount: 120 }))).toBe(false);
    expect(conditionMet({ kind: "wipAbove", value: 120 }, probe({ wipCount: 121 }))).toBe(true);
    expect(conditionMet({ kind: "wipBelow", value: 120 }, probe({ wipCount: 120 }))).toBe(false);
    expect(conditionMet({ kind: "wipBelow", value: 120 }, probe({ wipCount: 119 }))).toBe(true);
  });

  it("treats break-even as not yet positive", () => {
    expect(conditionMet({ kind: "netPositive" }, probe({ netCents: 0 }))).toBe(false);
    expect(conditionMet({ kind: "netPositive" }, probe({ netCents: 1 }))).toBe(true);
  });

  it("counts scrap from the start of the jump, so it is never already met", () => {
    expect(conditionMet({ kind: "scrapAtLeast", value: 5 }, probe({ scrappedSoFar: 0 }))).toBe(false);
    expect(conditionMet({ kind: "scrapAtLeast", value: 5 }, probe({ scrappedSoFar: 5 }))).toBe(true);
  });

  it("is the same predicate the dialog uses to warn before a jump is spent", () => {
    // already-met is a real state: "run until WIP falls below 200" on a floor
    // of 120 would stop at the first hour, and saying so beforehand is the
    // whole reason this is one function rather than two
    expect(conditionMet({ kind: "wipBelow", value: 200 }, probe({ wipCount: 120 }))).toBe(true);
  });

  it("offers a row per condition kind, each hinted", () => {
    const kinds = JUMP_CONDITIONS.map((row) => row.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(JUMP_CONDITIONS.every((row) => row.hint.length > 0)).toBe(true);
    // only the two thresholds take a number
    expect(JUMP_CONDITIONS.filter((row) => row.needsValue).map((row) => row.kind)).toEqual([
      "wipAbove",
      "wipBelow",
      "scrapAtLeast",
    ]);
  });
});

describe("alreadyMet", () => {
  const run = { wipCount: 120, netCents: -45_000 };

  it("answers what the summary knows", () => {
    expect(alreadyMet({ kind: "wipBelow", value: 200 }, run)).toBe(true);
    expect(alreadyMet({ kind: "wipAbove", value: 200 }, run)).toBe(false);
    expect(alreadyMet({ kind: "netPositive" }, run)).toBe(false);
    expect(alreadyMet({ kind: "netPositive" }, { ...run, netCents: 10 })).toBe(true);
  });

  it("refuses to guess at the backlog, which only an advance reports", () => {
    expect(alreadyMet({ kind: "floorDrained" }, { ...run, wipCount: 0 })).toBeNull();
    expect(alreadyMet({ kind: "backlogClear" }, run)).toBeNull();
  });

  it("never calls scrap already met, since it counts from the jump", () => {
    expect(alreadyMet({ kind: "scrapAtLeast", value: 1 }, run)).toBe(false);
  });
});

describe("describeStop", () => {
  it("always names where the run landed", () => {
    for (const outcome of [
      { kind: "horizon" } as const,
      { kind: "stopped" } as const,
      { kind: "drained" } as const,
      { kind: "condition" as const, condition: { kind: "netPositive" } as JumpCondition },
    ]) {
      expect(describeStop(outcome, probe(), DAY)).toContain("Day 3");
    }
  });

  it("says what the run did, not what the control did", () => {
    expect(
      describeStop(
        { kind: "condition", condition: { kind: "wipAbove", value: 100 } },
        probe({ wipCount: 137 }),
        DAY,
      ),
    ).toContain("WIP rose to 137, above 100");
  });

  it("reports a person's stop as a stop, not as a result", () => {
    expect(describeStop({ kind: "stopped" }, probe(), DAY)).toMatch(/^Stopped at /);
  });
});
