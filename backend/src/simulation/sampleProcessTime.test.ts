import { describe, it, expect } from "vitest";
import {
  PROCESS_TIME_DEVIATION,
  sampleProcessTime,
  unitDraw,
  type DrawKey,
} from "./sampleProcessTime.js";

const key = (overrides: Partial<DrawKey> = {}): DrawKey => ({
  seed: 42,
  partId: "11111111-1111-4111-8111-111111111111",
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
    expect(unitDraw(key({ partId: "other" }))).not.toBe(base);
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
});
