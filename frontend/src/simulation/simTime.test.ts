import { describe, expect, it } from "vitest";
import { chartBucket, formatDays, formatDurationSeconds, formatTickShort, formatTickTime, ticksToDays, MAX_CHART_POINTS, TICKS_PER_DAY } from "./simTime";

describe("ticksToDays", () => {
  it("converts a whole day exactly", () => {
    expect(ticksToDays(TICKS_PER_DAY)).toBe(1);
    expect(ticksToDays(2000, 1000)).toBe(2);
  });

  it("keeps fractions of a day", () => {
    expect(ticksToDays(500, 1000)).toBe(0.5);
  });

  it("converts zero ticks to zero days", () => {
    expect(ticksToDays(0)).toBe(0);
  });
});

describe("formatDays", () => {
  it("rounds to one decimal", () => {
    expect(formatDays(0.649)).toBe("0.6 days");
    expect(formatDays(2.96)).toBe("3 days");
  });

  it("uses the singular only for exactly one day after rounding", () => {
    expect(formatDays(1.04)).toBe("1 day");
    expect(formatDays(1.06)).toBe("1.1 days");
  });
});

describe("formatTickTime", () => {
  it("starts the run at Day 1 · 0:00:00", () => {
    expect(formatTickTime(0)).toBe("Day 1 · 0:00:00");
  });

  it("reads staffed hours, minutes and seconds within the day", () => {
    expect(formatTickTime(3_600 + 62)).toBe("Day 1 · 1:01:02");
  });

  it("rolls to the next day at ticksPerDay", () => {
    expect(formatTickTime(TICKS_PER_DAY)).toBe("Day 2 · 0:00:00");
    expect(formatTickTime(25, 10)).toBe("Day 3 · 0:00:05");
  });
});

describe("chartBucket", () => {
  it("stays at raw seconds while the run fits on screen", () => {
    expect(chartBucket(0)).toBe(1);
    expect(chartBucket(MAX_CHART_POINTS)).toBe(1);
  });

  it("coarsens to minutes, then hours, as the run outgrows the screen", () => {
    expect(chartBucket(MAX_CHART_POINTS + 1)).toBe(60);
    expect(chartBucket(MAX_CHART_POINTS * 60)).toBe(60);
    expect(chartBucket(MAX_CHART_POINTS * 60 + 1)).toBe(3_600);
  });

  it("keeps a full day at minute resolution", () => {
    expect(chartBucket(TICKS_PER_DAY)).toBe(60);
  });
});

describe("formatTickShort", () => {
  it("drops seconds and keeps the day", () => {
    expect(formatTickShort(0)).toBe("D1 0:00");
    expect(formatTickShort(19_140)).toBe("D1 5:19");
    expect(formatTickShort(TICKS_PER_DAY + 3_660)).toBe("D2 1:01");
  });
});

describe("formatDurationSeconds", () => {
  it("grades seconds, minutes, hours", () => {
    expect(formatDurationSeconds(45)).toBe("45s");
    expect(formatDurationSeconds(950)).toBe("15.8m");
    expect(formatDurationSeconds(9_816)).toBe("2.7h");
  });

  it("reads null as a dash and zero as a duration", () => {
    expect(formatDurationSeconds(null)).toBe("—");
    expect(formatDurationSeconds(0)).toBe("0s");
  });
});
