import { describe, expect, it } from "vitest";
import type { AgentPlan } from "./sse";
import {
  isSpent,
  planBounds,
  remainingCents,
  spentFraction,
  verbLabel,
} from "./planDisplay";

function grant(overrides: Partial<AgentPlan> = {}): AgentPlan {
  return {
    purpose: "test a second drill press",
    runIds: [58, 59],
    verbs: ["advance_to_tick", "capital_action"],
    toTick: 230_400,
    maxSpendCents: 200_000,
    spentCents: 0,
    ...overrides,
  };
}

describe("remainingCents", () => {
  it("is what is left of the ceiling", () => {
    expect(remainingCents(grant({ spentCents: 148_800 }))).toBe(51_200);
  });

  it("never goes negative, because an over-ceiling charge pauses instead", () => {
    expect(remainingCents(grant({ spentCents: 500_000 }))).toBe(0);
  });
});

describe("spentFraction", () => {
  it("is the committed share of the ceiling", () => {
    expect(spentFraction(grant({ spentCents: 100_000 }))).toBe(0.5);
  });

  it("is zero with no ceiling, rather than dividing by one", () => {
    expect(spentFraction(grant({ maxSpendCents: 0 }))).toBe(0);
  });

  it("does not exceed a full bar when the ceiling is exactly met", () => {
    expect(spentFraction(grant({ spentCents: 200_000 }))).toBe(1);
  });
});

describe("isSpent", () => {
  it("is true only once a real ceiling is used up", () => {
    expect(isSpent(grant({ spentCents: 200_000 }))).toBe(true);
    expect(isSpent(grant({ spentCents: 199_999 }))).toBe(false);
  });

  it("is false for a plan that was never allowed to spend", () => {
    // Such a plan can still advance and re-policy, so calling it "spent"
    // would imply the money was the whole grant.
    expect(isSpent(grant({ maxSpendCents: 0 }))).toBe(false);
  });
});

describe("verbLabel", () => {
  it("says what a verb lets the agent do", () => {
    expect(verbLabel("capital_action")).toBe(
      "buy or retire machines and operators",
    );
  });

  it("falls back to the raw name rather than hiding an unknown power", () => {
    expect(verbLabel("sell_the_factory")).toBe("sell_the_factory");
  });
});

describe("planBounds", () => {
  it("reads the four limits as four rows", () => {
    const rows = planBounds(grant(), 28_800);
    expect(rows.map((row) => row.label)).toEqual([
      "Runs",
      "May",
      "Advance to",
      "May spend",
    ]);
    expect(rows[0]?.value).toBe("#58, #59");
    expect(rows[2]?.value).toBe("Day 9 · 0:00:00");
  });

  it("states the remaining ceiling, not the one the plan started with", () => {
    const rows = planBounds(grant({ spentCents: 148_800 }));
    expect(rows[3]?.value).toBe("$512.00 left of $2,000.00");
  });

  it("says plainly when a plan cannot advance or spend", () => {
    const rows = planBounds(grant({ toTick: null, maxSpendCents: 0 }));
    expect(rows[2]?.value).toBe("not at all");
    expect(rows[3]?.value).toBe("nothing");
  });

  it("does not leave an empty grant looking like an unbounded one", () => {
    const rows = planBounds(grant({ runIds: [], verbs: [] }));
    expect(rows[0]?.value).toBe("none");
    expect(rows[1]?.value).toBe("nothing");
  });
});
