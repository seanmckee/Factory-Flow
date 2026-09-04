import { describe, expect, it } from "vitest";
import { formatSpend } from "./capital";

describe("formatSpend", () => {
  it("says which way the money went", () => {
    expect(formatSpend(120_000)).toBe("$1200.00 out");
    expect(formatSpend(-60_000)).toBe("$600.00 back");
  });

  it("calls a free action free rather than printing zero", () => {
    // letting an operator go costs nothing, and "$0.00" reads like a figure
    // that failed to load
    expect(formatSpend(0)).toBe("no cost");
  });
});
