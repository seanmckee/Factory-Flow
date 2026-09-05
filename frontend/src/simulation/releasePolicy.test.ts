import { describe, expect, it } from "vitest";
import { policySummary } from "./releasePolicy";

const run = {
  releasePolicy: "manual" as const,
  wipCap: 200,
  releaseLeadDays: 1,
  drumWorkCenterId: null as number | null,
  drumBuffer: 50,
};

describe("policySummary", () => {
  it("names manual without decoration", () => {
    expect(policySummary(run)).toBe("Manual");
  });

  it("shows conwip with its cap", () => {
    expect(policySummary({ ...run, releasePolicy: "conwip", wipCap: 1200 })).toBe(
      "CONWIP · cap 1,200",
    );
  });

  it("pluralises the due-date lead", () => {
    expect(policySummary({ ...run, releasePolicy: "due_date" })).toBe(
      "Due date · 1 day lead",
    );
    expect(
      policySummary({ ...run, releasePolicy: "due_date", releaseLeadDays: 2 }),
    ).toBe("Due date · 2 days lead");
  });

  it("resolves the drum name when the caller can, falls back to the id", () => {
    const dbr = {
      ...run,
      releasePolicy: "dbr" as const,
      drumWorkCenterId: 5,
      drumBuffer: 50,
    };
    expect(policySummary(dbr, (id) => (id === 5 ? "Drill Press" : undefined))).toBe(
      "DBR · Drill Press · buffer 50",
    );
    expect(policySummary(dbr)).toBe("DBR · WC 5 · buffer 50");
  });

  it("says so when a dbr run has no drum", () => {
    expect(policySummary({ ...run, releasePolicy: "dbr" })).toBe(
      "DBR · no drum · buffer 50",
    );
  });
});
