import { describe, it, expect } from "vitest";
import {
  PROCESS_TIME_DEVIATION,
  sampleProcessTime,
  unitDraw,
  type DrawKey,
} from "./sampleProcessTime.js";

const key = (overrides: Partial<DrawKey> = {}): DrawKey => ({
  seed: 42,
  workOrderId: 10,
  unitIndex: 0,
  stepIndex: 0,
  ...overrides,
});

describe("unitDraw", () => {
  it("is the same value every time for the same key", () => {
    expect(unitDraw(key())).toBe(unitDraw(key()));
  });

  it("differs when any one part of the key differs", () => {
    const base = unitDraw(key());
    expect(unitDraw(key({ seed: 43 }))).not.toBe(base);
    expect(unitDraw(key({ stepIndex: 1 }))).not.toBe(base);
    expect(unitDraw(key({ workOrderId: 11 }))).not.toBe(base);
    expect(unitDraw(key({ unitIndex: 1 }))).not.toBe(base);
  });

  it("stays in [0, 1)", () => {
    for (let i = 0; i < 1000; i++) {
      const draw = unitDraw(key({ stepIndex: i }));
      expect(draw).toBeGreaterThanOrEqual(0);
      expect(draw).toBeLessThan(1);
    }
  });

  it("spreads consecutive step indices across the range", () => {
    // consecutive keys differ by one bit before the avalanche; if that leaked
    // through, a part's successive steps would all draw nearly the same factor
    const draws = Array.from({ length: 400 }, (_, i) =>
      unitDraw(key({ stepIndex: i })),
    );
    const mean = draws.reduce((sum, d) => sum + d, 0) / draws.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);

    const quartiles = [0, 0, 0, 0];
    for (const draw of draws) quartiles[Math.floor(draw * 4)]!++;
    for (const count of quartiles) expect(count).toBeGreaterThan(60);
  });
});

describe("sampleProcessTime", () => {
  it("stays within the deviation band around the nominal time", () => {
    for (let i = 0; i < 500; i++) {
      const actual = sampleProcessTime(
        100,
        PROCESS_TIME_DEVIATION,
        key({ stepIndex: i }),
      );
      expect(actual).toBeGreaterThanOrEqual(70);
      expect(actual).toBeLessThanOrEqual(130);
    }
  });

  it("never returns less than one second", () => {
    for (let i = 0; i < 500; i++) {
      expect(sampleProcessTime(1, 0.9, key({ stepIndex: i }))).toBeGreaterThanOrEqual(1);
    }
  });

  it("is exactly the nominal time when there is no deviation", () => {
    expect(sampleProcessTime(7, 0, key())).toBe(7);
  });

  it("reproduces a run's draws from the seed alone", () => {
    const replay = (seed: number) =>
      [0, 1, 2].map((stepIndex) =>
        sampleProcessTime(60, PROCESS_TIME_DEVIATION, key({ seed, stepIndex })),
      );

    expect(replay(7)).toEqual(replay(7));
    expect(replay(7)).not.toEqual(replay(8));
  });

  it("draws the same for two units at the same position of the same order", () => {
    // the key holds nothing minted at release, which is what the uuid version
    // of this key got wrong: a re-created run drew fresh noise and a comparison
    // against it measured the dice instead of the decision
    const unit = (workOrderId: number, unitIndex: number) =>
      [0, 1, 2].map((stepIndex) =>
        sampleProcessTime(
          60,
          PROCESS_TIME_DEVIATION,
          key({ workOrderId, unitIndex, stepIndex }),
        ),
      );

    expect(unit(10, 3)).toEqual(unit(10, 3));
    expect(unit(10, 3)).not.toEqual(unit(10, 4));
    expect(unit(10, 3)).not.toEqual(unit(11, 3));
  });
});

describe("draw domains", () => {
  const pinned: DrawKey = { seed: 42, workOrderId: 7, unitIndex: 3, stepIndex: 2 };

  it("keeps the process draw byte-identical to the pre-domain key", () => {
    // pinned before domains existed: re-creating a pre-6C run from its seed
    // must still reproduce it exactly, so the process key never changes shape
    expect(unitDraw(pinned)).toBe(0.08393415343016386);
    expect(unitDraw(pinned, "process")).toBe(0.08393415343016386);
  });

  it("draws the scrap domain independently of the process domain", () => {
    // without the separator a unit's scrap fate would be the same uniform as
    // its process time — "slow units always scrap" is aliasing, not noise
    expect(unitDraw(pinned, "scrap")).not.toBe(unitDraw(pinned));
  });

  it("is deterministic within the scrap domain", () => {
    expect(unitDraw(pinned, "scrap")).toBe(unitDraw(pinned, "scrap"));
  });
});
