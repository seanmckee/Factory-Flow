import { dollarsToCents } from "../orders/salesOrderMath";
import type { WorkCenter } from "../types/WorkCenter";

/**
 * The editable numeric columns of a work center, as data.
 *
 * Eight fields is where hand-copying an editor per column stops being
 * reasonable: the page previously repeated a validate/diff/assign block per
 * field, and the failure mode is silent — add a column to the type, forget it
 * in the commit, and the input edits nothing. So the *fields* are a spec while
 * the table cells stay explicit at the call site, which is the convention's
 * actual point (bespoke cells, not bespoke plumbing).
 *
 * `count` fields are whole numbers; `money` fields are typed in dollars and
 * sent as cents, the carrying-rate convention.
 */
export type FieldKind = "count" | "money";

export type WorkCenterField = {
  /** the draft key, and the input's identity */
  key: string;
  /** the API/`WorkCenter` property it commits to */
  column: keyof Omit<WorkCenter, "id" | "name">;
  kind: FieldKind;
  /** table header and dialog label */
  label: string;
  /** what the number means, for the create dialog */
  unit: string;
  /** smallest accepted value: machines need one, everything else allows zero */
  min: number;
  /** the input's width class in the table */
  width: string;
};

export const WORK_CENTER_FIELDS: WorkCenterField[] = [
  {
    key: "capacity",
    column: "capacity",
    kind: "count",
    label: "Machines",
    unit: "",
    min: 1,
    width: "w-16",
  },
  {
    key: "operators",
    column: "operators",
    kind: "count",
    label: "Operators",
    unit: "",
    // zero is legal: a centre nobody staffs runs nothing, which the model
    // charges for rather than forbids
    min: 0,
    width: "w-16",
  },
  {
    key: "standingCost",
    column: "standingCostCentsPerDay",
    kind: "money",
    label: "Standing cost",
    unit: "$/day per machine",
    min: 0,
    width: "w-24",
  },
  {
    key: "wage",
    column: "wageCentsPerHour",
    kind: "money",
    label: "Wage",
    unit: "$/hr per operator",
    min: 0,
    width: "w-20",
  },
  {
    key: "machinePurchase",
    column: "machinePurchaseCents",
    kind: "money",
    label: "Machine",
    unit: "$ to buy one",
    min: 0,
    width: "w-24",
  },
  {
    key: "machineSalvage",
    column: "machineSalvageCents",
    kind: "money",
    label: "Salvage",
    unit: "$ back when retired",
    min: 0,
    width: "w-24",
  },
  {
    key: "operatorHire",
    column: "operatorHireCents",
    kind: "money",
    label: "Hire",
    unit: "$ to onboard one",
    min: 0,
    width: "w-20",
  },
];

/** What a field currently reads as in an input: dollars for money, else raw. */
export function fieldText(field: WorkCenterField, value: number): string {
  return field.kind === "money" ? (value / 100).toFixed(2) : String(value);
}

/** Every field of a work center as editable text, for seeding a draft. */
export function toDraftFields(workCenter: WorkCenter): Record<string, string> {
  return Object.fromEntries(
    WORK_CENTER_FIELDS.map((field) => [
      field.key,
      fieldText(field, workCenter[field.column]),
    ]),
  );
}

/** The defaults a create dialog opens with: one machine, one operator, free. */
export function blankDraftFields(): Record<string, string> {
  return Object.fromEntries(
    WORK_CENTER_FIELDS.map((field) => [
      field.key,
      field.kind === "money" ? "0" : String(Math.max(field.min, 1)),
    ]),
  );
}

export type ParsedFields =
  | { ok: true; values: Partial<Record<string, number>> }
  | { ok: false; message: string };

/**
 * Parses every field, or names the first that fails in the message the user
 * sees. Money goes through `dollarsToCents` so "12.34" is 1234 exactly rather
 * than a float; a count must be a whole number.
 */
export function parseFields(text: Record<string, string>): ParsedFields {
  const values: Record<string, number> = {};
  for (const field of WORK_CENTER_FIELDS) {
    const raw = text[field.key] ?? "";
    const parsed =
      field.kind === "money" ? dollarsToCents(raw) : Number(raw);

    if (
      parsed === null ||
      !Number.isFinite(parsed) ||
      !Number.isInteger(parsed) ||
      parsed < field.min * (field.kind === "money" ? 100 : 1)
    ) {
      return {
        ok: false,
        message:
          field.kind === "money"
            ? `${field.label} must be ${field.min === 0 ? "zero or more" : "above zero"}`
            : `${field.label} must be a whole number ${
                field.min === 0 ? "of zero or more" : "above zero"
              }`,
      };
    }
    values[field.key] = parsed;
  }
  return { ok: true, values };
}

/**
 * The columns whose parsed value differs from what the server holds — so a
 * capacity edit cannot collide with somebody else's rename, the rule the
 * per-field version had and the reason only changed keys are sent.
 */
export function changedColumns(
  values: Partial<Record<string, number>>,
  workCenter: WorkCenter,
): Partial<Record<WorkCenterField["column"], number>> {
  const updates: Partial<Record<WorkCenterField["column"], number>> = {};
  for (const field of WORK_CENTER_FIELDS) {
    const next = values[field.key];
    if (next !== undefined && next !== workCenter[field.column]) {
      updates[field.column] = next;
    }
  }
  return updates;
}
