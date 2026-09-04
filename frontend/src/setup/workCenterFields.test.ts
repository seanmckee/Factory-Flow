import { describe, expect, it } from "vitest";
import {
  blankDraftFields,
  changedColumns,
  fieldText,
  parseFields,
  toDraftFields,
  WORK_CENTER_FIELDS,
} from "./workCenterFields";
import type { WorkCenter } from "../types/WorkCenter";

const center: WorkCenter = {
  id: 3,
  name: "Drill Press",
  capacity: 1,
  operators: 1,
  standingCostCentsPerDay: 30_000,
  wageCentsPerHour: 1_800,
  machinePurchaseCents: 120_000,
  machineSalvageCents: 60_000,
  operatorHireCents: 28_800,
};

describe("the field spec", () => {
  it("covers every editable column exactly once", () => {
    // the whole reason the spec exists: a column the spec forgets is an input
    // that silently edits nothing
    const columns = WORK_CENTER_FIELDS.map((field) => field.column);
    expect(new Set(columns).size).toBe(columns.length);
    expect(columns).toEqual([
      "capacity",
      "operators",
      "standingCostCentsPerDay",
      "wageCentsPerHour",
      "machinePurchaseCents",
      "machineSalvageCents",
      "operatorHireCents",
    ]);
  });
});

describe("fieldText", () => {
  it("shows money in dollars and counts as they are", () => {
    expect(fieldText(WORK_CENTER_FIELDS[0], 2)).toBe("2");
    expect(fieldText(WORK_CENTER_FIELDS[2], 30_000)).toBe("300.00");
  });
});

describe("toDraftFields", () => {
  it("round-trips a centre through text and back to the same cents", () => {
    const parsed = parseFields(toDraftFields(center));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(changedColumns(parsed.values, center)).toEqual({});
  });
});

describe("blankDraftFields", () => {
  it("opens on one machine, one operator and no cost", () => {
    expect(blankDraftFields()).toEqual({
      capacity: "1",
      operators: "1",
      standingCost: "0",
      wage: "0",
      machinePurchase: "0",
      machineSalvage: "0",
      operatorHire: "0",
    });
  });
});

describe("parseFields", () => {
  it("converts dollars to cents without floating-point slop", () => {
    const parsed = parseFields({ ...toDraftFields(center), wage: "12.34" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.values.wage).toBe(1234);
  });

  it("accepts zero operators — a centre nobody staffs is a legal mistake", () => {
    const parsed = parseFields({ ...toDraftFields(center), operators: "0" });
    expect(parsed.ok).toBe(true);
  });

  it("refuses zero machines, which is what retiring one is for", () => {
    const parsed = parseFields({ ...toDraftFields(center), capacity: "0" });
    expect(parsed).toEqual({
      ok: false,
      message: "Machines must be a whole number above zero",
    });
  });

  it("refuses a fractional count and a negative price, naming the field", () => {
    expect(parseFields({ ...toDraftFields(center), operators: "1.5" })).toEqual({
      ok: false,
      message: "Operators must be a whole number of zero or more",
    });
    expect(
      parseFields({ ...toDraftFields(center), machineSalvage: "-5" }),
    ).toEqual({ ok: false, message: "Salvage must be zero or more" });
  });

  it("refuses an empty field rather than reading it as zero", () => {
    expect(parseFields({ ...toDraftFields(center), wage: "" }).ok).toBe(false);
  });
});

describe("changedColumns", () => {
  it("names only what actually moved", () => {
    const parsed = parseFields({
      ...toDraftFields(center),
      operators: "2",
      machinePurchase: "1300.50",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(changedColumns(parsed.values, center)).toEqual({
      operators: 2,
      machinePurchaseCents: 130_050,
    });
  });
});
