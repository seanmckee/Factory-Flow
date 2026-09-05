import { describe, expect, it } from "vitest";
import { RUN_NAME_MAX, defaultForkName } from "./forkName.js";

describe("defaultForkName", () => {
  it("names the fork after the parent and the calendar day", () => {
    // Day is floor(tick / dayTicks) + 1, the formatTickTime convention
    expect(defaultForkName("Baseline", 57_600, 28_800)).toBe(
      "Baseline · fork @ D3",
    );
  });

  it("reads Day 1 at tick 0 — a fork before the first advance", () => {
    expect(defaultForkName("Baseline", 0, 28_800)).toBe(
      "Baseline · fork @ D1",
    );
  });

  it("counts days in the run's own frozen day width", () => {
    // two shifts: the same tick is an earlier day
    expect(defaultForkName("Two shifts", 57_600, 57_600)).toBe(
      "Two shifts · fork @ D2",
    );
  });

  it("truncates the parent's name, never the fork suffix", () => {
    const name = defaultForkName("x".repeat(300), 0, 28_800);
    expect(name).toHaveLength(RUN_NAME_MAX);
    expect(name.endsWith(" · fork @ D1")).toBe(true);
  });
});
