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
): StepDraft {
  return { workCenterId, processTimeSeconds, setupTimeSeconds };
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
      },
    ]);
    expect(drafts).toEqual([
      { workCenterId: "4", processTimeSeconds: "8", setupTimeSeconds: "2" },
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
        { workCenterId: 4, processTimeSeconds: 8, setupTimeSeconds: 2 },
        { workCenterId: 6, processTimeSeconds: 3, setupTimeSeconds: 1 },
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
});
