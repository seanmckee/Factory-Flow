import { describe, expect, it } from "vitest";
import {
  emptyStep,
  moveStep,
  parseSteps,
  removeStep,
  toDrafts,
} from "./routingSteps";
import type { StepDraft } from "./routingSteps";

function draft(
  workCenterId: string,
  processTimeSeconds = "5",
  setupTimeSeconds = "0",
  scrapPercent = "0",
): StepDraft {
  return { workCenterId, processTimeSeconds, setupTimeSeconds, scrapPercent };
}

describe("moveStep", () => {
  it("swaps a step with the one after it", () => {
    const steps = [draft("1"), draft("2"), draft("3")];
    expect(moveStep(steps, 0, 1).map((s) => s.workCenterId)).toEqual([
      "2",
      "1",
      "3",
    ]);
  });

  it("swaps a step with the one before it", () => {
    const steps = [draft("1"), draft("2"), draft("3")];
    expect(moveStep(steps, 2, -1).map((s) => s.workCenterId)).toEqual([
      "1",
      "3",
      "2",
    ]);
  });

  it("returns the list unchanged when moving past either end", () => {
    const steps = [draft("1"), draft("2")];
    expect(moveStep(steps, 0, -1)).toBe(steps);
    expect(moveStep(steps, 1, 1)).toBe(steps);
  });

  it("does not mutate the original list", () => {
    const steps = [draft("1"), draft("2")];
    moveStep(steps, 0, 1);
    expect(steps.map((s) => s.workCenterId)).toEqual(["1", "2"]);
  });
});

describe("removeStep", () => {
  it("drops only the step at that position", () => {
    const steps = [draft("1"), draft("2"), draft("3")];
    expect(removeStep(steps, 1).map((s) => s.workCenterId)).toEqual(["1", "3"]);
  });
});

describe("toDrafts", () => {
  it("turns saved steps into editable strings, dropping sequence", () => {
    const drafts = toDrafts([
      {
        id: 1,
        routingId: 9,
        workCenterId: 4,
        sequence: 1,
        processTimeSeconds: 8,
        setupTimeSeconds: 2,
        scrapBps: 50,
      },
    ]);
    expect(drafts).toEqual([
      {
        workCenterId: "4",
        processTimeSeconds: "8",
        setupTimeSeconds: "2",
        // 50 bps reads back as the percentage the user typed
        scrapPercent: "0.5",
      },
    ]);
  });
});

describe("parseSteps", () => {
  it("rejects an empty list", () => {
    expect(parseSteps([])).toEqual({
      ok: false,
      message: "A routing needs at least one step",
    });
  });

  it("converts a valid list to numbers in array order", () => {
    const result = parseSteps([draft("4", "8", "2"), draft("6", "3", "1")]);
    expect(result).toEqual({
      ok: true,
      steps: [
        { workCenterId: 4, processTimeSeconds: 8, setupTimeSeconds: 2, scrapBps: 0 },
        { workCenterId: 6, processTimeSeconds: 3, setupTimeSeconds: 1, scrapBps: 0 },
      ],
    });
  });

  it("allows a setup time of zero", () => {
    const result = parseSteps([draft("4", "8", "0")]);
    expect(result.ok).toBe(true);
  });

  it("reports an unchosen work center by 1-based position", () => {
    const result = parseSteps([draft("4"), emptyStep()]);
    expect(result).toEqual({
      ok: false,
      message: "Step 2: choose a work center",
    });
  });

  it("rejects a process time of zero", () => {
    const result = parseSteps([draft("4", "0", "0")]);
    expect(result.ok).toBe(false);
  });

  it("rejects a blank time rather than reading it as zero", () => {
    // Number("") is 0, which would otherwise pass the setup-time check
    const result = parseSteps([draft("4", "5", "")]);
    expect(result).toEqual({
      ok: false,
      message: "Step 1: setup time must be zero or a whole number above it",
    });
  });

  it("rejects a fractional process time", () => {
    const result = parseSteps([draft("4", "2.5", "0")]);
    expect(result.ok).toBe(false);
  });

  it("converts a scrap percentage to basis points", () => {
    const result = parseSteps([draft("4", "8", "0", "2.5")]);
    expect(result).toEqual({
      ok: true,
      steps: [
        { workCenterId: 4, processTimeSeconds: 8, setupTimeSeconds: 0, scrapBps: 250 },
      ],
    });
  });

  it("keeps a two-decimal percentage exact despite float multiplication", () => {
    // 0.03 * 100 is 3.0000000000000004 in floats; the tolerance absorbs it
    const result = parseSteps([draft("4", "8", "0", "0.03")]);
    expect(result.ok && result.steps[0]?.scrapBps).toBe(3);
  });

  it("rejects a scrap percentage finer than a basis point", () => {
    const result = parseSteps([draft("4", "8", "0", "0.005")]);
    expect(result).toEqual({
      ok: false,
      message: "Step 1: scrap must be 0\u2013100%, in steps of 0.01",
    });
  });

  it("rejects a scrap percentage above 100 or below zero", () => {
    expect(parseSteps([draft("4", "8", "0", "101")]).ok).toBe(false);
    expect(parseSteps([draft("4", "8", "0", "-1")]).ok).toBe(false);
  });

  it("rejects a blank scrap rate rather than reading it as zero", () => {
    expect(parseSteps([draft("4", "8", "0", "")]).ok).toBe(false);
  });
});
