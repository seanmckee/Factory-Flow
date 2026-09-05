/**
 * Release-policy display transforms — labels and the one-line summary the
 * Policy button and toasts show. Pure, like `capital.ts`: the policies
 * themselves run server-side, and the frontend only names them.
 */
export type ReleasePolicyKind = "manual" | "conwip" | "due_date" | "dbr";

export const POLICY_LABELS: Record<ReleasePolicyKind, string> = {
  manual: "Manual",
  conwip: "CONWIP",
  due_date: "Due date",
  dbr: "Drum-buffer-rope",
};

/** the POST /:id/policy body — omitted numeric fields keep the run's values */
export type PolicyChange = {
  releasePolicy: ReleasePolicyKind;
  wipCap?: number;
  releaseLeadDays?: number;
  drumWorkCenterId?: number | null;
  drumBuffer?: number;
};

/** the one-sentence explainer each policy shows in the dialog */
export const POLICY_HINTS: Record<ReleasePolicyKind, string> = {
  manual: "Nothing releases unless you release it.",
  conwip:
    "Keeps the floor fed to a WIP cap: when parts on the floor drop below it, the next order (earliest due date first) is released.",
  due_date:
    "Releases each order a lead time before its due date. Orders with no due date never auto-release.",
  dbr: "The Goal's rope: releases pace the bottleneck, keeping the drum's queue inside a buffer. Orders that never visit the drum release immediately.",
};

/**
 * "CONWIP · cap 200", "Due date · 1 day lead", "DBR · Drill Press · buffer
 * 50" — the active policy at a glance. `centerName` resolves the drum id when
 * the caller has the floor; without it the id shows as `WC 5`.
 */
export function policySummary(
  run: {
    releasePolicy: ReleasePolicyKind;
    wipCap: number;
    releaseLeadDays: number;
    drumWorkCenterId: number | null;
    drumBuffer: number;
  },
  centerName?: (workCenterId: number) => string | undefined,
): string {
  switch (run.releasePolicy) {
    case "manual":
      return POLICY_LABELS.manual;
    case "conwip":
      return `${POLICY_LABELS.conwip} · cap ${run.wipCap.toLocaleString()}`;
    case "due_date":
      return `${POLICY_LABELS.due_date} · ${run.releaseLeadDays} day${
        run.releaseLeadDays === 1 ? "" : "s"
      } lead`;
    case "dbr": {
      const drum =
        run.drumWorkCenterId === null
          ? "no drum"
          : (centerName?.(run.drumWorkCenterId) ?? `WC ${run.drumWorkCenterId}`);
      return `DBR · ${drum} · buffer ${run.drumBuffer.toLocaleString()}`;
    }
  }
}
