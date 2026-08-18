import { describe, it, expect } from "vitest";
import {
  dollarsToCents,
  formatSignedCents,
  throughputPerUnitCents,
} from "./salesOrderMath";

describe("dollarsToCents", () => {
  it("rounds rather than truncating the floating point product", () => {
    // 19.99 * 100 is 1998.9999... - truncating would store 1998
    expect(dollarsToCents("19.99")).toBe(1999);
    expect(dollarsToCents("42.50")).toBe(4250);
    expect(dollarsToCents("65")).toBe(6500);
  });

  it("returns null for an empty or non-numeric field", () => {
    expect(dollarsToCents("")).toBeNull();
    expect(dollarsToCents("abc")).toBeNull();
  });
});

describe("throughputPerUnitCents", () => {
  it("is price minus material cost, matching calculateThroughput", () => {
    expect(throughputPerUnitCents(5000, 1200)).toBe(3800);
  });

  it("goes negative below material cost", () => {
    expect(throughputPerUnitCents(500, 1200)).toBe(-700);
  });
});

describe("formatSignedCents", () => {
  it("puts the sign before the currency symbol", () => {
    expect(formatSignedCents(3800)).toBe("$38.00");
    expect(formatSignedCents(-700)).toBe("-$7.00");
    expect(formatSignedCents(0)).toBe("$0.00");
  });
});
